// ── Vite Plugin for Stream Deck React ───────────────────────────────
//
// Build infrastructure for Stream Deck React projects, exposed as a
// Vite plugin.
//
// Handles:
//
//   1. Native binding resolution and copying
//      @takumi-rs/core → platform-specific package (e.g. core-darwin-arm64)
//      → locate the .node file → copy to output directory
//
//   2. DevTools stripping in production builds
//      Replace the devtools module with a noop stub so the entire
//      devtools tree (HTTP server, SSE, bridge, intercepts) is
//      eliminated by the bundler's tree shaker.
//
//   3. Target platform configuration
//      Dev mode: auto-detect current platform
//      Production: requires explicit targets array (cross-compilation)
//
//   4. Code-first manifest generation
//      Action metadata is defined in defineAction({ info: { ... } }) and
//      auto-extracted from the module graph during the build.  The bundler
//      plugin's `manifest` option only contains plugin-level info.
//
//      Pipeline:
//        moduleParsed  → extract defineAction() calls from AST
//        writeBundle   → combine plugin info + extracted actions → manifest.json
//        closeBundle   → restart Stream Deck plugin
//
//   5. Font inlining
//      `.ttf`, `.otf`, `.woff`, `.woff2` imports are resolved to absolute
//      paths and loaded as synthetic ES modules containing base64 Buffers.

import { createRequire } from "node:module";
import { exec } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { Plugin, ResolvedConfig } from "vite";
import { resolveFontId, loadFont } from "./font-inline";
import {
  validatePluginUUID,
  validateManifestConfig,
  generateManifestJsonString,
  writeManifestIfChanged,
} from "./manifest-gen";
import type { ExtractedAction } from "./manifest-extract";
import { extractActionsFromAST, extractedToActionSource } from "./manifest-extract";
import type { ManifestConfig, PluginManifestInfo } from "./manifest-types";

// ── Platform & Target Types ─────────────────────────────────────────

export type StreamDeckPlatform = "darwin" | "win32";
export type StreamDeckArch = "arm64" | "x64";

export interface StreamDeckTarget {
  platform: StreamDeckPlatform;
  arch: StreamDeckArch;
}

/** Takumi renderer backend selection. Mirrors the runtime `TakumiBackend` type for build-time configuration. */
export type TakumiBackend = "native-binding" | "wasm";

export interface StreamDeckTargetOptions {
  targets?: StreamDeckTarget[];
  /**
   * Takumi renderer backend. When `"wasm"`, native `.node` binding
   * copying is skipped entirely during the build.
   * @default "native-binding"
   */
  takumi?: TakumiBackend;
}

export type {
  ManifestActionSource,
  PluginManifestInfo,
  ActionManifestInfo,
  ManifestController,
  ManifestEncoderInfo,
  ManifestTriggerDescription,
  ManifestStateInfo,
  ManifestOSInfo,
  ManifestNodejsInfo,
  ManifestProfileInfo,
} from "./manifest-types";

// ── Resolved Targets ────────────────────────────────────────────────

interface ResolvedTarget extends StreamDeckTarget {
  pkg: string;
  file: string;
}

const TARGETS: ResolvedTarget[] = [
  {
    platform: "darwin",
    arch: "arm64",
    pkg: "core-darwin-arm64",
    file: "core.darwin-arm64.node",
  },
  {
    platform: "darwin",
    arch: "x64",
    pkg: "core-darwin-x64",
    file: "core.darwin-x64.node",
  },
  {
    platform: "win32",
    arch: "arm64",
    pkg: "core-win32-arm64-msvc",
    file: "core.win32-arm64-msvc.node",
  },
  {
    platform: "win32",
    arch: "x64",
    pkg: "core-win32-x64-msvc",
    file: "core.win32-x64-msvc.node",
  },
];

// ── Platform Guards ─────────────────────────────────────────────────

function isPlatform(value: string): value is StreamDeckPlatform {
  return value === "darwin" || value === "win32";
}

function isArch(value: string): value is StreamDeckArch {
  return value === "arm64" || value === "x64";
}

// ── DevTools Stripping ──────────────────────────────────────────────
//
// In production builds, the devtools module import is redirected to a
// virtual module (NOOP_DEVTOOLS_ID) that exports a no-op function.
// The bundler's tree shaker then eliminates the entire devtools tree
// (server.ts, bridge.ts, intercepts, serialization) since nothing
// references it.  This removes ~2000 lines of debug-only code and
// the HTTP server dependency from production bundles.

const NOOP_DEVTOOLS_ID = "\0streamdeck-react:noop-devtools";
const NOOP_DEVTOOLS_CODE = "export function startDevtoolsServer() {}";
const DEVTOOLS_IMPORT_SOURCE = "./devtools/index.js";

// ── Takumi Native Loader Virtual Module ─────────────────────────────
//
// When bundlers inline dynamic imports,
// the @takumi-rs/core NAPI-RS loader (~585 lines) gets placed AFTER the
// entry point's top-level `await plugin.connect()`.  Since top-level
// await suspends module evaluation, the loader code never runs before
// initializeRenderer() tries to access the Renderer class.
//
// To fix this, the bundler plugin replaces `@takumi-rs/core` with a
// lightweight virtual module that loads the platform-specific .node
// binary directly.  As a static dependency, the bundler places it at
// the top of the bundle — before any top-level await.

const TAKUMI_NATIVE_LOADER_ID = "\0streamdeck-react:takumi-native";

// Simplified native binding loader that only covers Stream Deck
// platforms (darwin/win32 × arm64/x64).  Uses createRequire(import.meta.url)
// so the .node file is resolved relative to the bundled output, where
// copyNativeBindings() places it.
const TAKUMI_NATIVE_LOADER_CODE = `
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let binding = null;
if (process.platform === "darwin") {
  if (process.arch === "arm64") {
    try { binding = require("./core.darwin-arm64.node"); } catch {}
  } else if (process.arch === "x64") {
    try { binding = require("./core.darwin-x64.node"); } catch {}
  }
} else if (process.platform === "win32") {
  if (process.arch === "arm64") {
    try { binding = require("./core.win32-arm64-msvc.node"); } catch {}
  } else if (process.arch === "x64") {
    try { binding = require("./core.win32-x64-msvc.node"); } catch {}
  }
}
if (!binding) {
  throw new Error(
    "[@fcannizzaro/streamdeck-react] Failed to load @takumi-rs/core native binding for " +
    process.platform + "-" + process.arch
  );
}
export const { Renderer, OutputFormat, DitheringAlgorithm, AnimationOutputFormat, extractResourceUrls } = binding;
`.trim();

// ── DevTools & Target Helpers ───────────────────────────────────────

/**
 * Returns true when devtools should be stripped from the bundle.
 * Only strips in explicit production mode (NODE_ENV=production) to avoid
 * accidentally removing devtools during one-off development builds.
 */
function shouldStripDevtools(watchMode: boolean | undefined): boolean {
  if (watchMode) return false;
  return process.env.NODE_ENV === "production";
}

function isLibraryDevtoolsImport(source: string, importer: string | undefined): boolean {
  if (source !== DEVTOOLS_IMPORT_SOURCE || !importer) return false;
  const normalized = importer.replace(/\\/g, "/");
  return (
    normalized.includes("@fcannizzaro/streamdeck-react/") ||
    normalized.includes("streamdeck-react/dist/")
  );
}

function resolveTargets(request: StreamDeckTarget): ResolvedTarget[] {
  return TARGETS.filter((target) => {
    if (target.platform !== request.platform || target.arch !== request.arch) {
      return false;
    }
    return true;
  });
}

function normalizeTargetRequests(
  options: StreamDeckTargetOptions,
  isDevelopment: boolean,
): StreamDeckTarget[] {
  if (options.targets?.length) {
    return options.targets;
  }

  if (!isDevelopment || !isPlatform(process.platform) || !isArch(process.arch)) {
    return [];
  }

  return [
    {
      platform: process.platform,
      arch: process.arch,
    },
  ];
}

function expandTargets(targets: StreamDeckTarget[]): ResolvedTarget[] {
  const resolved = targets.flatMap((target) => {
    const matches = resolveTargets(target);

    if (matches.length > 0) {
      return matches;
    }

    throw new Error(
      `[@fcannizzaro/streamdeck-react] Unsupported native target: ${target.platform}-${target.arch}`,
    );
  });

  return resolved.filter(
    (target, index) => resolved.findIndex((item) => item.pkg === target.pkg) === index,
  );
}

// ── Native Binding Copy ─────────────────────────────────────────────
//
// Problem: Takumi (@takumi-rs/core) is a Rust/NAPI native addon
// compiled per-platform.  The bundler produces a single JS file, but
// the native `.node` binary must be copied alongside it for the
// Stream Deck's Node.js runtime to load via require().
//
// Resolution chain:
//   1. Resolve @takumi-rs/core entry point via createRequire
//   2. From core's directory, resolve each platform-specific package
//      (e.g. @takumi-rs/core-darwin-arm64)
//   3. Locate the .node file within the platform package
//   4. Copy to the bundler's output directory
//
// In development: missing bindings emit a warning (the current platform
// might not have a binding, which is fine during cross-platform dev).
// In production: missing bindings throw an error (the plugin won't work).

function copyNativeBindings(
  outDir: string,
  isDevelopment: boolean,
  options: StreamDeckTargetOptions,
  warn: (message: string) => void,
): void {
  // WASM mode: no native bindings to copy — the renderer runs entirely
  // in WebAssembly via @takumi-rs/wasm.
  if (options.takumi === "wasm") return;

  try {
    const requestedTargets = normalizeTargetRequests(options, isDevelopment);
    if (requestedTargets.length === 0) {
      if (isDevelopment) {
        throw new Error(
          "[@fcannizzaro/streamdeck-react] streamDeckReact() requires explicit targets. Pass a `targets` array.",
        );
      }
      warn(
        `[@fcannizzaro/streamdeck-react] Native binding for ${process.platform}-${process.arch} is not available locally. Please ensure the appropriate native module is loaded or lazy-loaded.`,
      );
      return;
    }

    const targets = expandTargets(requestedTargets);

    // Resolve from the @takumi-rs/core package location so that its
    // optional dependencies (the platform-specific binding packages)
    // are reachable through Node / Bun module resolution.
    const req = createRequire(import.meta.url);
    const coreEntry = req.resolve("@takumi-rs/core");
    const coreDir = dirname(coreEntry);
    const coreReq = createRequire(join(coreDir, "index.js"));

    const copied: string[] = [];
    const missing: string[] = [];

    for (const target of targets) {
      try {
        // The platform-specific packages don't restrict exports, so we can
        // resolve their package entry to find the directory.
        const bindingEntry = coreReq.resolve(`@takumi-rs/${target.pkg}`);
        const bindingDir = dirname(bindingEntry);
        const src = join(bindingDir, target.file);

        if (!existsSync(src)) {
          missing.push(target.file);
          continue;
        }

        const dest = join(outDir, target.file);
        copyFileSync(src, dest);
        copied.push(target.file);
      } catch {
        missing.push(target.file);
      }
    }

    if (missing.length > 0) {
      const message = `[@fcannizzaro/streamdeck-react] Missing native bindings for ${missing.join(", ")}`;

      if (!isDevelopment) {
        throw new Error(message);
      }

      warn(message);
    }

    if (copied.length === 0) {
      return;
    }

    console.log(`[@fcannizzaro/streamdeck-react] Copied ${copied.join(", ")} -> ${outDir}`);
  } catch (err) {
    if (err instanceof Error) {
      throw err;
    }

    throw new Error(
      `[@fcannizzaro/streamdeck-react] Failed to copy native binding: ${String(err)}`,
    );
  }
}

// ── Manifest Path Resolution ────────────────────────────────────────
//
// The manifest.json must be written to the .sdPlugin directory root,
// while the bundler output goes to a subdirectory (e.g. bin/).
//
// Output structure:
//
//   com.example.my-plugin.sdPlugin/
//     manifest.json       ← written by generateManifest
//     bin/
//       plugin.mjs        ← bundler output
//       core.*.node       ← native bindings
//
// We derive the .sdPlugin root from the bundler output directory
// by walking up until we find a *.sdPlugin directory, or by using
// the plugin UUID to construct the expected directory name.

/**
 * Resolve the .sdPlugin directory root from the bundler output directory.
 *
 * Strategy:
 *   1. Walk up from outDir looking for a parent named `*.sdPlugin`
 *   2. If not found, assume outDir's parent is the .sdPlugin root
 *      (handles `<uuid>.sdPlugin/bin/` → `<uuid>.sdPlugin/`)
 *
 * @returns The .sdPlugin directory path, or `null` if unresolvable.
 */
function resolvePluginDir(outDir: string): string | null {
  // Walk up from outDir looking for *.sdPlugin
  let dir = outDir;
  const root = dirname(dir);

  // Check outDir itself and its ancestors (max 3 levels up)
  for (let i = 0; i < 4; i++) {
    if (dir.endsWith(".sdPlugin")) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
  }

  // Fallback: if outDir is something like `.../com.example.sdPlugin/bin`,
  // the parent directory is the plugin root
  const parent = dirname(outDir);
  if (parent !== root && parent.endsWith(".sdPlugin")) {
    return parent;
  }

  return null;
}

/**
 * Derive the CodePath (manifest entry point) from the bundler output
 * file path, relative to the .sdPlugin directory.
 *
 * Example:
 *   outFile: "/project/com.example.sdPlugin/bin/plugin.mjs"
 *   pluginDir: "/project/com.example.sdPlugin"
 *   → "bin/plugin.mjs"
 */
function deriveCodePath(outFile: string, pluginDir: string): string {
  return relative(pluginDir, outFile).replace(/\\/g, "/");
}

// ── Plugin Options ──────────────────────────────────────────────────

export interface StreamDeckReactOptions extends StreamDeckTargetOptions {
  /**
   * The plugin UUID used to restart the plugin after each build
   * (e.g. `"com.example.react-pokemon"`).
   *
   * When set, the plugin will run `streamdeck restart <uuid>` after
   * each successful build.  If `manifest` is set, the UUID is
   * auto-derived from `manifest.uuid`.
   */
  uuid?: string;

  /**
   * Code-first manifest generation.  When a `PluginManifestInfo` object
   * is provided, the plugin generates `manifest.json` in the `.sdPlugin`
   * directory during `writeBundle`.
   *
   * Actions are **auto-extracted** from `defineAction()` calls in the
   * source code — no need to list them here.  The plugin scans the
   * module graph during the build and extracts `uuid`, `info`, and
   * component presence from each `defineAction()` call.
   *
   * Actions with `info.disabled: true` are skipped.
   *
   * Auto-derived defaults:
   *   - `CodePath` from the bundler output path
   *   - `Controllers` from key/dial/touchStrip presence
   *   - `OS`, `Nodejs`, `SDKVersion`, `Software` have defaults
   *   - `States` default to `[{ Image: icon }]`
   */
  manifest?: PluginManifestInfo;
}

// ── Vite Plugin ─────────────────────────────────────────────────────
//
// Responsibilities mapped to Vite lifecycle hooks:
//
//   configResolved  → detect dev/production mode, set strip flags
//   buildStart      → validate plugin UUID format (early check)
//   moduleParsed    → extract defineAction() metadata from each module
//   resolveId       → redirect devtools imports (production) + font imports
//   load            → return noop devtools stub + inline font as base64 Buffer
//   writeBundle     → copy native .node bindings + generate manifest.json
//   closeBundle     → restart Stream Deck plugin (optional, via CLI)

export function streamDeckReact(options: StreamDeckReactOptions = {}): Plugin {
  let resolvedConfig: ResolvedConfig;
  let isDevelopment = false;
  let stripDevtools = false;

  // ── Extracted actions accumulated during build ──────────────────
  const extractedActions: ExtractedAction[] = [];

  return {
    name: "fcannizzaro-streamdeck-react",
    apply: "build",
    enforce: "pre",

    configResolved(config) {
      resolvedConfig = config;
      const isWatch = config.build.watch !== null;
      isDevelopment = isWatch || process.env.NODE_ENV === "development";
      stripDevtools = shouldStripDevtools(isWatch);
    },

    buildStart() {
      // Early validation: plugin UUID format check
      if (options.manifest) {
        const uuidError = validatePluginUUID(options.manifest.uuid);
        if (uuidError) {
          resolvedConfig.logger.warn(`[@fcannizzaro/streamdeck-react] ${uuidError.message}`);
        }
      }

      // Clear any stale extracted actions from previous builds (watch mode)
      extractedActions.length = 0;
    },

    // ── Action Extraction ────────────────────────────────────────────
    //
    // Called for every module after all transform hooks have run.
    // The `moduleParsed` hook always receives the final transformed code
    // (after esbuild/babel strips TypeScript and JSX), regardless of
    // the plugin's `enforce` setting.
    //
    // We use `this.parse()` to get the AST since `moduleInfo.ast` may
    // be null when no transform plugin returned an AST explicitly.

    moduleParsed(moduleInfo) {
      if (!options.manifest) return;
      if (!moduleInfo.code?.includes("defineAction")) return;

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ast = (this as any).parse(moduleInfo.code) as unknown as Record<string, unknown>;
        const actions = extractActionsFromAST(ast);

        for (const action of actions) {
          // Skip actions with info.disabled
          if (action.info?.disabled) continue;
          extractedActions.push(action);
        }
      } catch {
        // Parse failure — skip this module silently.
      }
    },

    resolveId(source, importer) {
      // Strip devtools module in production builds
      if (stripDevtools && isLibraryDevtoolsImport(source, importer)) {
        return NOOP_DEVTOOLS_ID;
      }
      // Replace @takumi-rs/core with a lightweight native loader to avoid
      // the inlineDynamicImports ordering issue (see TAKUMI_NATIVE_LOADER_ID).
      if (options.takumi !== "wasm" && source === "@takumi-rs/core") {
        return TAKUMI_NATIVE_LOADER_ID;
      }
      return resolveFontId(source, importer);
    },

    load(id) {
      if (id === NOOP_DEVTOOLS_ID) return NOOP_DEVTOOLS_CODE;
      if (id === TAKUMI_NATIVE_LOADER_ID) return TAKUMI_NATIVE_LOADER_CODE;
      return loadFont(id);
    },

    writeBundle() {
      const outDir = resolve(resolvedConfig.root, resolvedConfig.build.outDir);

      // ── Native bindings ─────────────────────────────────────────
      copyNativeBindings(outDir, isDevelopment, options, (msg) => {
        resolvedConfig.logger.warn(msg);
      });

      // ── Manifest generation ─────────────────────────────────────
      if (options.manifest) {
        const pluginDir = resolvePluginDir(outDir);
        if (!pluginDir) {
          resolvedConfig.logger.warn(
            "[@fcannizzaro/streamdeck-react] Could not resolve .sdPlugin directory from output path. " +
              "Manifest generation skipped.",
          );
          return;
        }

        // Use the output dir relative to plugin dir as the CodePath base
        const outFile = join(outDir, "plugin.mjs");
        const codePath = deriveCodePath(outFile, pluginDir);

        // Build full ManifestConfig from plugin info + extracted actions
        const fullConfig: ManifestConfig = {
          ...options.manifest,
          actions: extractedActions.map(extractedToActionSource),
        };

        // Validate the complete config (action UUID prefixes, duplicates)
        const warn = (msg: string) => resolvedConfig.logger.warn(msg);
        const errors = validateManifestConfig(fullConfig, warn);
        if (errors.length > 0) {
          resolvedConfig.logger.warn(
            `[@fcannizzaro/streamdeck-react] Manifest validation found ${errors.length} issue(s)`,
          );
        }

        const content = generateManifestJsonString(fullConfig, codePath);
        const manifestPath = join(pluginDir, "manifest.json");
        const written = writeManifestIfChanged(manifestPath, content);

        if (written) {
          resolvedConfig.logger.info(`[@fcannizzaro/streamdeck-react] Generated ${manifestPath}`);
        }
      }
    },

    closeBundle() {
      // Auto-restart: derive UUID from manifest config or explicit option
      const uuid = options.uuid ?? options.manifest?.uuid;
      if (!uuid) return;

      exec(`streamdeck restart ${uuid}`, (err) => {
        if (err) {
          console.warn(`[streamdeck-restart] ${err.message}`);
        }
      });
    },
  };
}
