import { createRequire } from "node:module";
import { copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

// ── Shared Build Infrastructure ─────────────────────────────────────
//
// Common logic shared between the Vite and Rollup bundler plugins.
//
// Problem: Takumi (@takumi-rs/core) is a Rust/NAPI native addon
// compiled per-platform.  The bundler produces a single JS file, but
// the native `.node` binary must be copied alongside it for the
// Stream Deck's Node.js runtime to load via require().
//
// This module handles:
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

export interface ResolvedTarget extends StreamDeckTarget {
  pkg: string;
  file: string;
}

export const TARGETS: ResolvedTarget[] = [
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

export function isPlatform(value: string): value is StreamDeckPlatform {
  return value === "darwin" || value === "win32";
}

export function isArch(value: string): value is StreamDeckArch {
  return value === "arm64" || value === "x64";
}

export function isDevelopmentMode(watchMode: boolean | undefined): boolean {
  return watchMode || process.env.NODE_ENV === "development";
}

// ── DevTools stripping constants ────────────────────────────────────
// In production builds, the devtools module import is redirected to a
// virtual module (NOOP_DEVTOOLS_ID) that exports a no-op function.
// The bundler's tree shaker then eliminates the entire devtools tree
// (server.ts, bridge.ts, intercepts, serialization) since nothing
// references it.  This removes ~2000 lines of debug-only code and
// the HTTP server dependency from production bundles.

export const NOOP_DEVTOOLS_ID = "\0streamdeck-react:noop-devtools";
export const NOOP_DEVTOOLS_CODE = "export function startDevtoolsServer() {}";
const DEVTOOLS_IMPORT_SOURCE = "./devtools/index.js";

// ── Takumi native loader virtual module ─────────────────────────────
//
// When bundlers inline dynamic imports (Rollup's inlineDynamicImports),
// the @takumi-rs/core NAPI-RS loader (~585 lines) gets placed AFTER the
// entry point's top-level `await plugin.connect()`.  Since top-level
// await suspends module evaluation, the loader code never runs before
// initializeRenderer() tries to access the Renderer class.
//
// To fix this, the bundler plugin replaces `@takumi-rs/core` with a
// lightweight virtual module that loads the platform-specific .node
// binary directly.  As a static dependency, the bundler places it at
// the top of the bundle — before any top-level await.

export const TAKUMI_NATIVE_LOADER_ID = "\0streamdeck-react:takumi-native";

// Simplified native binding loader that only covers Stream Deck
// platforms (darwin/win32 × arm64/x64).  Uses createRequire(import.meta.url)
// so the .node file is resolved relative to the bundled output, where
// copyNativeBindings() places it.
export const TAKUMI_NATIVE_LOADER_CODE = `
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

/**
 * Returns true when devtools should be stripped from the bundle.
 * Only strips in explicit production mode (NODE_ENV=production) to avoid
 * accidentally removing devtools during one-off development builds.
 */
export function shouldStripDevtools(watchMode: boolean | undefined): boolean {
  if (watchMode) return false;
  return process.env.NODE_ENV === "production";
}

export function isLibraryDevtoolsImport(source: string, importer: string | undefined): boolean {
  if (source !== DEVTOOLS_IMPORT_SOURCE || !importer) return false;
  const normalized = importer.replace(/\\/g, "/");
  return (
    normalized.includes("@fcannizzaro/streamdeck-react/") ||
    normalized.includes("streamdeck-react/dist/")
  );
}

export function resolveTargets(request: StreamDeckTarget): ResolvedTarget[] {
  return TARGETS.filter((target) => {
    if (target.platform !== request.platform || target.arch !== request.arch) {
      return false;
    }
    return true;
  });
}

export function normalizeTargetRequests(
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

export function expandTargets(targets: StreamDeckTarget[]): ResolvedTarget[] {
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

/**
 * Core logic for copying native bindings to the output directory.
 * Shared between the Rollup and Vite plugins.
 *
 * Resolution chain:
 *   1. Resolve @takumi-rs/core entry point via createRequire
 *   2. From core's directory, resolve each platform-specific package
 *      (e.g. @takumi-rs/core-darwin-arm64)
 *   3. Locate the .node file within the platform package
 *   4. Copy to the bundler's output directory
 *
 * In development: missing bindings emit a warning (the current platform
 * might not have a binding, which is fine during cross-platform dev).
 * In production: missing bindings throw an error (the plugin won't work).
 */
export function copyNativeBindings(
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
        warn(
          `[@fcannizzaro/streamdeck-react] No native binding available for ${process.platform}-${process.arch}`,
        );
        return;
      }

      throw new Error(
        "[@fcannizzaro/streamdeck-react] streamDeckReact() requires explicit targets when building for production. Pass a `targets` array.",
      );
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
