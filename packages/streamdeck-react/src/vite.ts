// ── Vite Plugin for Stream Deck React ───────────────────────────────
//
// Build infrastructure for Stream Deck React projects, exposed as a
// Vite plugin.
//
// Handles:
//
//   1. Native binding resolution — lazy download (default) or copy
//      @takumi-rs/core → platform-specific package (e.g. core-darwin-arm64)
//      + user-provided native modules via the `nativeModules` option
//
//      Lazy mode (default):
//        resolveId → virtual module with download-on-demand code
//        At runtime: existsSync? → require() cached .node file
//                    else → fetch npm tarball → extract → cache → require()
//
//      Copy mode (nativeBindings: "copy"):
//        resolveId → virtual module with static require() code
//        writeBundle → locate .node in node_modules → copy to output dir
//
//   2. DevTools stripping in production builds
//      Replace the devtools module with a noop stub so the entire
//      devtools tree (HTTP server, SSE, bridge, intercepts) is
//      eliminated by the bundler's tree shaker.
//
//   3. Target platform configuration
//      Dev mode: auto-detect current platform
//      Production: requires explicit targets array (copy mode only)
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
import { copyFileSync, existsSync, readFileSync } from "node:fs";
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
import {
  extractActionsFromAST,
  extractCreatePluginActionOrder,
  extractedToActionSource,
} from "./manifest-extract";
import type { ManifestConfig, PluginManifestInfo } from "./manifest-types";
import { NATIVE_VERSIONS_FILENAME } from "./native-versions";

// ── Platform & Target Types ─────────────────────────────────────────

export type StreamDeckPlatform = "darwin" | "win32";
export type StreamDeckArch = "arm64" | "x64";

export interface StreamDeckTarget {
  platform: StreamDeckPlatform;
  arch: StreamDeckArch;
}

/** Takumi renderer backend selection. Mirrors the runtime `TakumiBackend` type for build-time configuration. */
export type TakumiBackend = "native-binding" | "wasm";

/**
 * Native binding loading strategy.
 *
 * - `"lazy"` — download from npm on first use at runtime (default).
 * - `"copy"` — copy from node_modules during the build (requires `targets`).
 */
export type NativeBindingsMode = "lazy" | "copy";

export interface StreamDeckTargetOptions {
  targets?: StreamDeckTarget[];
  /**
   * Takumi renderer backend. When `"wasm"`, native `.node` binding
   * handling is skipped entirely during the build.
   * @default "native-binding"
   */
  takumi?: TakumiBackend;
}

/**
 * Configuration for a native `.node` module that should be lazy-loaded
 * (downloaded from npm at runtime) or copied from `node_modules` at
 * build time.
 *
 * The built-in Takumi renderer binding (`@takumi-rs/core`) is always
 * registered automatically — use this interface to add additional
 * native modules that follow the same NAPI-RS platform-package pattern.
 *
 * @example
 * ```ts
 * {
 *   importSpecifier: "@mypkg/native-core",
 *   scope: "@mypkg",
 *   bindings: {
 *     "darwin-arm64": { pkg: "native-core-darwin-arm64", file: "native.darwin-arm64.node" },
 *     "win32-x64":   { pkg: "native-core-win32-x64",    file: "native.win32-x64-msvc.node" },
 *   },
 *   exports: ["MyClass", "helperFn"],
 * }
 * ```
 */
export interface NativeModuleConfig {
  /**
   * The npm import specifier to intercept during bundling.
   * When any module imports this specifier, the bundler replaces it
   * with a virtual loader that handles the native binding.
   *
   * @example "@mypkg/native-core"
   */
  importSpecifier: string;

  /**
   * The npm scope under which platform-specific packages are published.
   * Used to construct the npm tarball download URL in lazy mode.
   *
   * When omitted, auto-inferred from `importSpecifier` if it's a
   * scoped package (e.g., `"@mypkg/foo"` → `"@mypkg"`).
   *
   * @example "@mypkg"
   */
  scope?: string;

  /**
   * Platform → binding mapping.  Keys are `"<platform>-<arch>"` strings
   * matching `process.platform + "-" + process.arch` at runtime.
   *
   * Each value specifies the npm package name (unscoped) and the
   * `.node` filename within that package.
   *
   * @example
   * {
   *   "darwin-arm64": { pkg: "native-core-darwin-arm64", file: "native.darwin-arm64.node" },
   *   "darwin-x64":   { pkg: "native-core-darwin-x64",   file: "native.darwin-x64.node" },
   *   "win32-arm64":  { pkg: "native-core-win32-arm64",  file: "native.win32-arm64-msvc.node" },
   *   "win32-x64":    { pkg: "native-core-win32-x64",    file: "native.win32-x64-msvc.node" },
   * }
   */
  bindings: Record<string, { pkg: string; file: string }>;

  /**
   * Named exports to destructure and re-export from the loaded binding.
   * These become the virtual module's ES named exports.
   *
   * @example ["MyRenderer", "OutputFormat", "helperFn"]
   */
  exports: string[];

  /**
   * Explicit version string for the npm tarball URL (lazy mode only).
   * When omitted, auto-resolved from the installed package's
   * `package.json` at build time.
   */
  version?: string;
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

export { NATIVE_VERSIONS_FILENAME } from "./native-versions";
export type { NativeVersionsManifest } from "./native-versions";

// ── Built-In Native Module: @takumi-rs/core ─────────────────────────
//
// Takumi is always registered as a native module (unless `takumi: "wasm"`).
// This config is the single source of truth for Takumi's platform bindings,
// replacing the previously separate TARGETS array, TAKUMI_NATIVE_LOADER_CODE,
// and hardcoded bindings map in buildLazyLoaderCode.

const TAKUMI_NATIVE_MODULE: NativeModuleConfig = {
  importSpecifier: "@takumi-rs/core",
  scope: "@takumi-rs",
  bindings: {
    "darwin-arm64": { pkg: "core-darwin-arm64", file: "core.darwin-arm64.node" },
    "darwin-x64": { pkg: "core-darwin-x64", file: "core.darwin-x64.node" },
    "win32-arm64": { pkg: "core-win32-arm64-msvc", file: "core.win32-arm64-msvc.node" },
    "win32-x64": { pkg: "core-win32-x64-msvc", file: "core.win32-x64-msvc.node" },
  },
  exports: [
    "Renderer",
    "OutputFormat",
    "DitheringAlgorithm",
    "AnimationOutputFormat",
    "extractResourceUrls",
  ],
};

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

// ── Native Module Virtual IDs ───────────────────────────────────────
//
// Each registered native module gets two virtual module IDs:
//   - lazy:   download-on-demand at runtime (default strategy)
//   - static: require() a .node file copied at build time
//
// The import specifier is embedded in the ID so the resolveId/load
// hooks can match multiple native modules in a single pass.

function lazyVirtualId(specifier: string): string {
  return `\0streamdeck-react:lazy:${specifier}`;
}

function staticVirtualId(specifier: string): string {
  return `\0streamdeck-react:native:${specifier}`;
}

// ── Scope Resolution ────────────────────────────────────────────────
//
// Resolves the npm scope for a NativeModuleConfig.  If the user
// provided an explicit `scope`, use it.  Otherwise, infer from
// the import specifier (e.g., "@mypkg/foo" → "@mypkg").

function resolveScope(config: NativeModuleConfig): string {
  if (config.scope) return config.scope;

  if (config.importSpecifier.startsWith("@")) {
    const slashIdx = config.importSpecifier.indexOf("/");
    if (slashIdx !== -1) {
      return config.importSpecifier.slice(0, slashIdx);
    }
  }

  throw new Error(
    `[@fcannizzaro/streamdeck-react] Cannot infer npm scope for "${config.importSpecifier}". ` +
      `Provide an explicit "scope" in the NativeModuleConfig.`,
  );
}

// ── Static Native Loader Code Generation ────────────────────────────
//
// Produces a lightweight virtual module that uses createRequire to load
// the platform-specific .node file from the bundle output directory.
// Used when nativeBindings is "copy" — the .node files are placed
// alongside the bundle by copyNativeBindings() during writeBundle.

function buildStaticLoaderCode(config: NativeModuleConfig): string {
  const lines: string[] = [
    'import { createRequire } from "node:module";',
    "const require = createRequire(import.meta.url);",
    "let binding = null;",
  ];

  // Group bindings by platform for a clean if/else chain that mirrors
  // the platform detection pattern of NAPI-RS loaders.
  const byPlatform = new Map<string, { arch: string; file: string }[]>();

  for (const [key, value] of Object.entries(config.bindings)) {
    const dashIdx = key.indexOf("-");
    if (dashIdx === -1) continue;
    const platform = key.slice(0, dashIdx);
    const arch = key.slice(dashIdx + 1);
    let entries = byPlatform.get(platform);
    if (!entries) {
      entries = [];
      byPlatform.set(platform, entries);
    }
    entries.push({ arch, file: value.file });
  }

  let firstPlatform = true;
  for (const [platform, archEntries] of byPlatform) {
    lines.push(
      `${firstPlatform ? "if" : "} else if"} (process.platform === ${JSON.stringify(platform)}) {`,
    );
    firstPlatform = false;
    let firstArch = true;
    for (const { arch, file } of archEntries) {
      lines.push(
        `  ${firstArch ? "if" : "} else if"} (process.arch === ${JSON.stringify(arch)}) {`,
      );
      firstArch = false;
      lines.push(`    try { binding = require(${JSON.stringify("./" + file)}); } catch {}`);
    }
    lines.push("  }");
  }
  if (!firstPlatform) lines.push("}");

  lines.push("if (!binding) {");
  lines.push("  throw new Error(");
  lines.push(
    `    ${JSON.stringify(`Failed to load ${config.importSpecifier} native binding for `)} +`,
  );
  lines.push('    process.platform + "-" + process.arch');
  lines.push("  );");
  lines.push("}");

  const namedExports = config.exports.join(", ");
  lines.push(`export const { ${namedExports} } = binding;`);

  return lines.join("\n");
}

// ── Lazy Native Loader ──────────────────────────────────────────────
//
// When nativeBindings is "lazy" (the default), each native module's
// import specifier is replaced with a self-contained virtual module
// that downloads the platform-specific .node binary from npm on first
// use.
//
// Build time: the installed package version is resolved from its
// package.json and baked into the generated code.
//
// Runtime (first load):
//   Read .native-versions.json manifest
//   needsDownload = !existsSync(nodePath) || cachedVersion ≠ VERSION
//     no  → require() the cached .node file (fast path)
//     yes → fetch npm tarball → gunzipSync → minimal tar parse
//           → writeFileSync the .node file
//           → update .native-versions.json with new version
//           → require() it
//
// The .node file is written next to the bundle output (import.meta.url)
// and persists across restarts.  The version manifest ensures that
// dependency upgrades trigger a re-download even when a stale .node
// file already exists on disk (see native-versions.ts).

// ── Version Resolution ──────────────────────────────────────────────
//
// Resolves an installed native module's version at build time.
//
// Strategies (tried in order until one succeeds):
//
//   1. Resolve the package entry via createRequire from the Vite
//      project root, then walk up the directory tree to find its
//      package.json.  Uses the project root so that workspace-
//      specific dependencies (e.g. plugin/node_modules/) are
//      reachable.
//
//   2. Fallback: also try from the library's own location
//      (import.meta.url) for cases where the package is hoisted.
//
//   3. Direct node_modules lookup: walk up from configRoot looking
//      for <specifier>/package.json in node_modules directories.
//      This handles packages whose `exports` map lacks a "require"
//      condition (which makes createRequire().resolve() throw).

function resolveNativeModuleVersion(importSpecifier: string, configRoot?: string): string | null {
  // ── Strategy 1 & 2: resolve entry point, walk up to package.json ──
  const bases: string[] = [];
  if (configRoot) {
    bases.push(join(configRoot, "__resolve__.js"));
  }
  bases.push(import.meta.url);

  for (const base of bases) {
    try {
      const req = createRequire(base);
      const entry = req.resolve(importSpecifier);
      let dir = dirname(entry);

      for (let i = 0; i < 5; i++) {
        const pkgPath = join(dir, "package.json");
        if (existsSync(pkgPath)) {
          const raw = readFileSync(pkgPath, "utf8");
          const pkg = JSON.parse(raw) as { name?: string; version?: string };
          if (pkg.name === importSpecifier && pkg.version) {
            return pkg.version;
          }
        }
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    } catch {
      // Try next base
    }
  }

  // ── Strategy 3: direct node_modules walk ──────────────────────────
  //
  // Handles packages whose `exports` map only has "import" / "types"
  // conditions (no "require" or "default"), causing req.resolve() to
  // throw "No exports main defined".  We bypass module resolution
  // entirely and scan node_modules directories up the tree.
  const startDir = configRoot ?? dirname(import.meta.url.replace("file://", ""));
  let walkDir = startDir;
  for (let i = 0; i < 10; i++) {
    const candidate = join(walkDir, "node_modules", ...importSpecifier.split("/"), "package.json");
    if (existsSync(candidate)) {
      try {
        const raw = readFileSync(candidate, "utf8");
        const pkg = JSON.parse(raw) as { name?: string; version?: string };
        if (pkg.name === importSpecifier && pkg.version) {
          return pkg.version;
        }
      } catch {
        // Malformed package.json — continue walking
      }
    }
    const parent = dirname(walkDir);
    if (parent === walkDir) break;
    walkDir = parent;
  }

  return null;
}

// ── Lazy Loader Code Generation ─────────────────────────────────────
//
// Produces a self-contained ESM module string for a given
// NativeModuleConfig.  The generated code includes:
//   - import.meta.url-relative path resolution
//   - createRequire for loading the .node file (native addons can't
//     be loaded via import)
//   - gunzipSync for decompressing the npm .tgz tarball
//   - A minimal inline tar parser (~15 lines) that scans 512-byte
//     headers to find the target .node file
//   - Top-level await for the fetch call (valid in Node 14.8+ ESM)
//
// The version string and npm scope are baked in at build time from
// the NativeModuleConfig.

function buildLazyLoaderCode(config: NativeModuleConfig, version: string): string {
  const bindings = JSON.stringify(config.bindings);
  const namedExports = config.exports.join(", ");
  const scope = resolveScope(config);
  const label = config.importSpecifier;

  //   npm tarballs are gzipped tar archives.  The tar format uses
  //   fixed 512-byte headers per file entry:
  //
  //     Offset  Length  Content
  //     0       100     Filename (null-terminated ASCII)
  //     124     12      File size (octal ASCII)
  //
  //   After each header, the file data follows, padded to the next
  //   512-byte boundary.  The parser scans headers sequentially until
  //   it finds one whose name ends with the target .node filename,
  //   extracts that range, and writes it to disk.
  return [
    'import { createRequire } from "node:module";',
    'import { existsSync, readFileSync, writeFileSync } from "node:fs";',
    'import { gunzipSync } from "node:zlib";',
    'import { fileURLToPath } from "node:url";',
    'import { dirname, join } from "node:path";',
    "",
    "const require = createRequire(import.meta.url);",
    "const __dir = dirname(fileURLToPath(import.meta.url));",
    "",
    `const VERSION = ${JSON.stringify(version)};`,
    `const SCOPE = ${JSON.stringify(scope)};`,
    `const BINDINGS = ${bindings};`,
    "",
    'const key = process.platform + "-" + process.arch;',
    "const entry = BINDINGS[key];",
    "",
    "if (!entry) {",
    "  throw new Error(",
    `    ${JSON.stringify(`[${label}] Unsupported platform: `)} + key +`,
    '    ". Supported: " + Object.keys(BINDINGS).join(", ")',
    "  );",
    "}",
    "",
    "const nodePath = join(__dir, entry.file);",
    `const versionsPath = join(__dir, ${JSON.stringify(NATIVE_VERSIONS_FILENAME)});`,
    "",
    "// Read the version manifest to detect stale cached binaries.",
    "// When VERSION (baked at build time) differs from the cached",
    "// version, the .node file is re-downloaded even if it exists.",
    "let versions = {};",
    "try {",
    '  versions = JSON.parse(readFileSync(versionsPath, "utf8"));',
    "} catch {}",
    "",
    "const cachedVersion = versions[entry.file];",
    "const needsDownload = !existsSync(nodePath) || cachedVersion !== VERSION;",
    "",
    "if (needsDownload) {",
    "  if (cachedVersion && cachedVersion !== VERSION) {",
    `    console.log(${JSON.stringify(`[${label}] Version changed (`)} + cachedVersion + " -> " + VERSION + "), re-downloading...");`,
    "  }",
    "",
    "  const tarballUrl =",
    '    "https://registry.npmjs.org/" + SCOPE + "/" + entry.pkg +',
    '    "/-/" + entry.pkg + "-" + VERSION + ".tgz";',
    "",
    "  console.log(",
    `    ${JSON.stringify(`[${label}] Downloading `)} + entry.pkg +`,
    '    "@" + VERSION + " for " + key + "..."',
    "  );",
    "",
    "  const res = await fetch(tarballUrl);",
    "",
    "  if (!res.ok) {",
    "    throw new Error(",
    `      ${JSON.stringify(`[${label}] Failed to download native binding `)} +`,
    '      "(HTTP " + res.status + "): " + tarballUrl',
    "    );",
    "  }",
    "",
    "  const compressed = new Uint8Array(await res.arrayBuffer());",
    "  const tar = gunzipSync(compressed);",
    "",
    "  const target = entry.file;",
    "  let offset = 0;",
    "  let found = false;",
    "",
    "  while (offset + 512 <= tar.length) {",
    "    let nameEnd = offset;",
    "    while (nameEnd < offset + 100 && tar[nameEnd] !== 0) nameEnd++;",
    "    const name = new TextDecoder().decode(tar.subarray(offset, nameEnd));",
    "",
    "    if (name.length === 0) break;",
    "",
    "    const sizeStr = new TextDecoder()",
    "      .decode(tar.subarray(offset + 124, offset + 136))",
    '      .replace(/\\0.*$/, "")',
    "      .trim();",
    "    const size = parseInt(sizeStr, 8) || 0;",
    "    const dataStart = offset + 512;",
    "",
    "    if (name.endsWith(target)) {",
    "      writeFileSync(nodePath, tar.subarray(dataStart, dataStart + size));",
    "      found = true;",
    "      break;",
    "    }",
    "",
    "    offset = dataStart + Math.ceil(size / 512) * 512;",
    "  }",
    "",
    "  if (!found) {",
    "    throw new Error(",
    `      ${JSON.stringify(`[${label}] .node file '`)} + target +`,
    '      "\' not found in npm tarball"',
    "    );",
    "  }",
    "",
    "  console.log(",
    `    ${JSON.stringify(`[${label}] Native binding cached at `)} + nodePath`,
    "  );",
    "",
    "  // Update the version manifest so subsequent loads skip the download.",
    "  versions[entry.file] = VERSION;",
    "  writeFileSync(versionsPath, JSON.stringify(versions, null, 2));",
    "}",
    "",
    "const binding = require(nodePath);",
    `export const { ${namedExports} } = binding;`,
  ].join("\n");
}

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

// ── Native Module Validation ────────────────────────────────────────
//
// Validates user-provided nativeModules entries at build time.
// Catches configuration errors early (before the build wastes time).

function validateNativeModules(modules: NativeModuleConfig[], builtInFiles: Set<string>): void {
  const seen = new Set<string>();
  const files = new Set(builtInFiles);

  for (const mod of modules) {
    // Duplicate import specifier
    if (seen.has(mod.importSpecifier)) {
      throw new Error(
        `[@fcannizzaro/streamdeck-react] Duplicate nativeModules importSpecifier: "${mod.importSpecifier}"`,
      );
    }
    seen.add(mod.importSpecifier);

    // Takumi collision — users should use the `takumi` option instead
    if (mod.importSpecifier === "@takumi-rs/core") {
      throw new Error(
        `[@fcannizzaro/streamdeck-react] "@takumi-rs/core" is managed automatically. ` +
          `Do not add it to nativeModules — use the "takumi" option instead.`,
      );
    }

    // Empty exports
    if (mod.exports.length === 0) {
      throw new Error(
        `[@fcannizzaro/streamdeck-react] nativeModules entry "${mod.importSpecifier}" has an empty "exports" array.`,
      );
    }

    // Empty bindings
    if (Object.keys(mod.bindings).length === 0) {
      throw new Error(
        `[@fcannizzaro/streamdeck-react] nativeModules entry "${mod.importSpecifier}" has an empty "bindings" map.`,
      );
    }

    // Scope must be resolvable
    resolveScope(mod);

    // .node filename collision across all registered modules
    for (const binding of Object.values(mod.bindings)) {
      if (files.has(binding.file)) {
        throw new Error(
          `[@fcannizzaro/streamdeck-react] Duplicate .node filename "${binding.file}" across native modules. ` +
            `Each binding file must have a unique name.`,
        );
      }
      files.add(binding.file);
    }
  }
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

// ── Native Binding Copy (nativeBindings: "copy" only) ───────────────
//
// Used when nativeBindings is "copy".  The default "lazy" mode skips
// this entirely — binaries are downloaded at runtime instead.
//
// For each registered native module, this function:
//   1. Resolves the main package entry point via createRequire
//   2. From that directory, resolves each platform-specific package
//   3. Locates the .node file within the platform package
//   4. Copies to the bundler's output directory
//
// In development: missing bindings emit a warning (the current platform
// might not have a binding, which is fine during cross-platform dev).
// In production: missing bindings throw an error (the plugin won't work).

function copyNativeBindings(
  outDir: string,
  isDevelopment: boolean,
  options: StreamDeckTargetOptions,
  modules: NativeModuleConfig[],
  warn: (message: string) => void,
): void {
  if (modules.length === 0) return;

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

    // Build the set of platform-arch keys the user requested
    const requestedKeys = requestedTargets.map((t) => `${t.platform}-${t.arch}`);

    const copied: string[] = [];
    const missing: string[] = [];
    const req = createRequire(import.meta.url);

    for (const mod of modules) {
      // Resolve from the main package location so that its optional
      // dependencies (the platform-specific binding packages) are
      // reachable through Node / Bun module resolution.
      let modReq: NodeRequire;
      try {
        const entry = req.resolve(mod.importSpecifier);
        const modDir = dirname(entry);
        modReq = createRequire(join(modDir, "index.js"));
      } catch {
        // Main package not resolvable — mark all requested bindings as missing
        for (const key of requestedKeys) {
          const binding = mod.bindings[key];
          if (binding) missing.push(binding.file);
        }
        continue;
      }

      const scope = resolveScope(mod);

      for (const key of requestedKeys) {
        const binding = mod.bindings[key];
        if (!binding) continue; // This module doesn't support this platform-arch

        try {
          // The platform-specific packages don't restrict exports, so we can
          // resolve their package entry to find the directory.
          const bindingEntry = modReq.resolve(`${scope}/${binding.pkg}`);
          const bindingDir = dirname(bindingEntry);
          const src = join(bindingDir, binding.file);

          if (!existsSync(src)) {
            missing.push(binding.file);
            continue;
          }

          const dest = join(outDir, binding.file);
          copyFileSync(src, dest);
          copied.push(binding.file);
        } catch {
          missing.push(binding.file);
        }
      }
    }

    if (missing.length > 0) {
      const message = `[@fcannizzaro/streamdeck-react] Missing native bindings: ${missing.join(", ")}`;

      if (!isDevelopment) {
        throw new Error(message);
      }

      warn(message);
    }

    if (copied.length > 0) {
      console.log(`[@fcannizzaro/streamdeck-react] Copied ${copied.join(", ")} -> ${outDir}`);
    }
  } catch (err) {
    if (err instanceof Error) {
      throw err;
    }

    throw new Error(
      `[@fcannizzaro/streamdeck-react] Failed to copy native bindings: ${String(err)}`,
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
   * The plugin UUID used to restart the plugin during watch-mode builds
   * (e.g. `"com.example.react-pokemon"`).
   *
   * When set and the build is running with `--watch`, the plugin will
   * run `streamdeck restart <uuid>` after each successful rebuild.
   * One-shot builds (without `--watch`) never trigger a restart.
   * If `manifest` is set, the UUID is auto-derived from `manifest.uuid`.
   */
  uuid?: string;

  /**
   * Native binding loading strategy.
   *
   * - `"lazy"` (default) — the `.node` binary is downloaded from npm
   *   on first use at runtime.  No platform-specific packages need to
   *   be installed at build time — only the main `@takumi-rs/core`
   *   package (for types and version resolution).  The binary is
   *   cached on disk next to the bundle output for subsequent loads.
   *
   * - `"copy"` — platform-specific `.node` binaries are copied from
   *   `node_modules` during the build.  Requires platform packages
   *   (e.g. `@takumi-rs/core-darwin-arm64`) to be installed and
   *   `targets` to be specified.
   *
   * Ignored when `takumi` is `"wasm"`.
   *
   * @default "lazy"
   */
  nativeBindings?: NativeBindingsMode;

  /**
   * Additional native modules to lazy-load (or copy) alongside the
   * built-in Takumi binding.
   *
   * Each entry receives the same treatment as `@takumi-rs/core`:
   *   - `"lazy"` mode: virtual module with runtime npm download
   *   - `"copy"` mode: `.node` files copied from `node_modules` at build time
   *
   * The `nativeBindings` option controls the strategy for ALL native
   * modules (both Takumi and user-defined ones).
   *
   * @default []
   * @example
   * ```ts
   * nativeModules: [{
   *   importSpecifier: "@mypkg/native-core",
   *   scope: "@mypkg",
   *   bindings: {
   *     "darwin-arm64": { pkg: "native-core-darwin-arm64", file: "native.darwin-arm64.node" },
   *     "darwin-x64":   { pkg: "native-core-darwin-x64",   file: "native.darwin-x64.node" },
   *     "win32-x64":    { pkg: "native-core-win32-x64",    file: "native.win32-x64-msvc.node" },
   *   },
   *   exports: ["MyRenderer", "Format"],
   * }]
   * ```
   */
  nativeModules?: NativeModuleConfig[];

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
//   configResolved  → detect dev/production mode, set strip flags,
//                     determine native binding strategy (lazy vs copy)
//   buildStart      → validate plugin UUID and nativeModules config,
//                     register native modules (Takumi + user-defined),
//                     resolve versions for lazy loading
//   moduleParsed    → extract defineAction() metadata from each module
//   resolveId       → redirect devtools imports (production) + font imports
//                     + replace native module imports with virtual loaders
//   load            → return noop devtools stub / native loader /
//                     inline font as base64 Buffer
//   writeBundle     → copy native .node bindings (copy mode only) +
//                     generate manifest.json
//   closeBundle     → restart Stream Deck plugin (optional, via CLI)

export function streamDeckReact(options: StreamDeckReactOptions = {}): Plugin {
  let resolvedConfig: ResolvedConfig;
  let isDevelopment = false;
  let isWatchMode = false;
  let stripDevtools = false;

  // ── Native binding strategy ────────────────────────────────────
  //
  // "lazy" (default): generate a runtime download-on-demand virtual
  //   module.  Each native module's version is resolved at build time
  //   and baked into the generated code.  At runtime, the .node file
  //   is downloaded from npm on first use and cached on disk.
  //
  // "copy": platform-specific .node files are copied from
  //   node_modules to the output directory during writeBundle.
  //   Requires `targets` to be specified.
  let useLazyMode = false;

  // ── Native module registry ─────────────────────────────────────
  //
  // Maps importSpecifier → resolved virtual module info.
  // Populated in buildStart from the built-in Takumi config plus
  // any user-provided nativeModules entries.
  //
  // resolveId looks up source in this map.
  // load uses the reverse map (virtualId → code) for O(1) matching.

  interface RegisteredNativeModule {
    config: NativeModuleConfig;
    lazy: boolean;
    virtualId: string;
    code: string | null;
  }

  const nativeModulesBySpecifier = new Map<string, RegisteredNativeModule>();
  const nativeCodeByVirtualId = new Map<string, string | null>();

  function registerNativeModule(config: NativeModuleConfig): void {
    const lazy = useLazyMode;
    let virtualId: string;
    let code: string | null;

    if (lazy) {
      const version =
        config.version ?? resolveNativeModuleVersion(config.importSpecifier, resolvedConfig.root);

      if (version) {
        virtualId = lazyVirtualId(config.importSpecifier);
        code = buildLazyLoaderCode(config, version);
        resolvedConfig.logger.info(
          `[@fcannizzaro/streamdeck-react] Lazy native bindings: ${config.importSpecifier}@${version}`,
        );
      } else {
        // Fallback to copy mode for this specific module
        resolvedConfig.logger.warn(
          `[@fcannizzaro/streamdeck-react] Could not resolve ${config.importSpecifier} version. ` +
            'Falling back to nativeBindings: "copy" for this module.',
        );
        virtualId = staticVirtualId(config.importSpecifier);
        code = buildStaticLoaderCode(config);
      }
    } else {
      virtualId = staticVirtualId(config.importSpecifier);
      code = buildStaticLoaderCode(config);
    }

    const entry: RegisteredNativeModule = { config, lazy, virtualId, code };
    nativeModulesBySpecifier.set(config.importSpecifier, entry);
    nativeCodeByVirtualId.set(virtualId, code);
  }

  // ── Extracted actions accumulated during build ──────────────────
  //
  // Each entry tracks the extracted action metadata and the resolved
  // module ID it was extracted from.  The module ID is used to sort
  // actions according to the createPlugin({ actions }) order.
  const extractedActions: { action: ExtractedAction; moduleId: string }[] = [];

  // ── Action ordering from createPlugin() ───────────────────────────
  //
  // When the entry module contains `createPlugin({ actions: [...] })`,
  // we extract the action order and store a moduleId → position map.
  // At writeBundle time, extractedActions is sorted by this map so the
  // manifest's actions array matches the developer-defined order.
  let actionModuleOrder: Map<string, number> | null = null;

  return {
    name: "fcannizzaro-streamdeck-react",
    apply: "build",
    enforce: "pre",

    configResolved(config) {
      resolvedConfig = config;
      const isWatch = config.build.watch !== null;
      isWatchMode = isWatch;
      isDevelopment = isWatch || process.env.NODE_ENV === "development";
      stripDevtools = shouldStripDevtools(isWatch);

      // Determine native binding mode.
      // WASM mode always skips native bindings entirely.
      useLazyMode = options.takumi !== "wasm" && (options.nativeBindings ?? "lazy") === "lazy";
    },

    buildStart() {
      // Early validation: plugin UUID format check
      if (options.manifest) {
        const uuidError = validatePluginUUID(options.manifest.uuid);
        if (uuidError) {
          resolvedConfig.logger.warn(`[@fcannizzaro/streamdeck-react] ${uuidError.message}`);
        }
      }

      // Clear registries from previous builds (watch mode)
      nativeModulesBySpecifier.clear();
      nativeCodeByVirtualId.clear();
      extractedActions.length = 0;
      actionModuleOrder = null;

      // Register the built-in Takumi native module (unless WASM mode)
      if (options.takumi !== "wasm") {
        registerNativeModule(TAKUMI_NATIVE_MODULE);
      }

      // Validate and register user-provided native modules
      if (options.nativeModules?.length) {
        // Collect Takumi's .node filenames so the validator can
        // detect cross-module filename collisions
        const builtInFiles = new Set<string>();
        if (options.takumi !== "wasm") {
          for (const binding of Object.values(TAKUMI_NATIVE_MODULE.bindings)) {
            builtInFiles.add(binding.file);
          }
        }
        validateNativeModules(options.nativeModules, builtInFiles);

        for (const mod of options.nativeModules) {
          registerNativeModule(mod);
        }
      }
    },

    // ── Action Extraction & Ordering ───────────────────────────────────
    //
    // Called for every module after all transform hooks have run.
    // The `moduleParsed` hook always receives the final transformed code
    // (after esbuild/babel strips TypeScript and JSX), regardless of
    // the plugin's `enforce` setting.
    //
    // We use `this.parse()` to get the AST since `moduleInfo.ast` may
    // be null when no transform plugin returned an AST explicitly.
    //
    // Two extraction tasks happen here:
    //
    //   1. defineAction() extraction — collect action metadata from each
    //      module that calls defineAction(), tagged with the module's
    //      resolved ID for later sorting.
    //
    //   2. createPlugin() ordering — when a module calls createPlugin(),
    //      extract the actions array order and build a moduleId → position
    //      map.  Rollup's importedIds (same order as AST import/export-from
    //      declarations) is used to resolve import specifiers to module IDs.

    moduleParsed(moduleInfo) {
      if (!options.manifest) return;

      const code = moduleInfo.code;
      if (!code) return;

      const hasDefineAction = code.includes("defineAction");
      const hasCreatePlugin = code.includes("createPlugin");
      if (!hasDefineAction && !hasCreatePlugin) return;

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ast = (this as any).parse(code) as unknown as Record<string, unknown>;

        // ── defineAction() extraction ───────────────────────────────
        if (hasDefineAction) {
          const actions = extractActionsFromAST(ast);

          for (const action of actions) {
            // Skip actions with info.disabled
            if (action.info?.disabled) continue;
            extractedActions.push({ action, moduleId: moduleInfo.id });
          }
        }

        // ── createPlugin() action order extraction ──────────────────
        //
        // When we find createPlugin({ actions: [a, b, c] }), we:
        //   1. Extract identifier names in array order
        //   2. Map identifiers to import source specifiers
        //   3. Correlate import specifiers with Rollup's resolved IDs
        //      using position matching (orderedModuleSources[i] ↔ importedIds[i])
        //   4. Build a moduleId → position map for sorting
        if (hasCreatePlugin) {
          const order = extractCreatePluginActionOrder(ast);
          if (order) {
            // Build import specifier → resolved module ID mapping.
            // orderedModuleSources is extracted in AST body order (matching
            // the order Rollup uses to populate importedIds).
            const importedIds = moduleInfo.importedIds;
            const specifierToResolvedId = new Map<string, string>();

            for (let i = 0; i < order.orderedModuleSources.length && i < importedIds.length; i++) {
              const source = order.orderedModuleSources[i];
              const resolvedId = importedIds[i];
              if (source != null && resolvedId != null) {
                specifierToResolvedId.set(source, resolvedId);
              }
            }

            // Build moduleId → position from the createPlugin actions order.
            // Local variables (not imported) map to the current module's ID.
            const moduleOrder = new Map<string, number>();

            for (let i = 0; i < order.identifiers.length; i++) {
              const name = order.identifiers[i]!;
              const source = order.importSourceByIdentifier.get(name);
              const moduleId =
                source !== undefined ? specifierToResolvedId.get(source) : moduleInfo.id; // local variable

              if (moduleId != null && !moduleOrder.has(moduleId)) {
                moduleOrder.set(moduleId, i);
              }
            }

            actionModuleOrder = moduleOrder;
          }
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

      // Replace native module imports with virtual loaders.
      // This covers both the built-in Takumi binding and any
      // user-provided nativeModules entries.
      const nativeMod = nativeModulesBySpecifier.get(source);
      if (nativeMod) {
        return nativeMod.virtualId;
      }

      return resolveFontId(source, importer);
    },

    load(id) {
      if (id === NOOP_DEVTOOLS_ID) return NOOP_DEVTOOLS_CODE;

      // Native module virtual loaders (lazy or static)
      const nativeCode = nativeCodeByVirtualId.get(id);
      if (nativeCode !== undefined) return nativeCode;

      return loadFont(id);
    },

    writeBundle() {
      const outDir = resolve(resolvedConfig.root, resolvedConfig.build.outDir);

      // ── Native bindings ─────────────────────────────────────────
      // Collect modules that are in copy (non-lazy) mode and need
      // their .node files copied to the output directory.
      const copyModules: NativeModuleConfig[] = [];
      for (const entry of nativeModulesBySpecifier.values()) {
        if (!entry.lazy) {
          copyModules.push(entry.config);
        }
      }

      if (copyModules.length > 0) {
        copyNativeBindings(outDir, isDevelopment, options, copyModules, (msg: string) => {
          resolvedConfig.logger.warn(msg);
        });
      }

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

        // ── Sort actions by createPlugin() order ──────────────────────
        //
        // If the entry module contained createPlugin({ actions: [...] }),
        // actionModuleOrder maps each action module's resolved ID to its
        // position in the array.  Sort extractedActions so the manifest
        // matches the developer's intended order.
        //
        // Actions from modules not in the order map (edge case) are
        // appended at the end in their original extraction order.
        if (actionModuleOrder != null && actionModuleOrder.size > 0) {
          extractedActions.sort((a, b) => {
            const ai = actionModuleOrder!.get(a.moduleId) ?? Number.MAX_SAFE_INTEGER;
            const bi = actionModuleOrder!.get(b.moduleId) ?? Number.MAX_SAFE_INTEGER;
            return ai - bi;
          });
        }

        // Build full ManifestConfig from plugin info + extracted actions
        const fullConfig: ManifestConfig = {
          ...options.manifest,
          actions: extractedActions.map(({ action }) => extractedToActionSource(action)),
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
      // Auto-restart: only in watch mode (e.g. `vite build --watch`).
      // One-shot production builds should not restart the plugin —
      // the CLI may not even be available in CI/CD environments.
      if (!isWatchMode) return;

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
