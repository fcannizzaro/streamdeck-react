// ── Rollup Plugin for Stream Deck React ─────────────────────────────
//
// Rollup counterpart of the Vite plugin (vite.ts).  Handles the same
// build-time concerns via shared infrastructure:
//
//   1. Font inlining       — .ttf/.otf/.woff/.woff2 → base64 Buffer
//   2. Native bindings     — copy Takumi .node to output directory
//   3. Devtools stripping  — replace devtools import with noop in production
//   4. Manifest generation — auto-extracted from defineAction() calls
//
// Manifest generation (code-first, zero-config for actions):
//
//   Action metadata is defined in defineAction({ info: { ... } }) and
//   auto-extracted from the module graph during the build.  The bundler
//   plugin's `manifest` option only contains plugin-level info (uuid,
//   name, author, description, icon, version).
//
//   Pipeline:
//     moduleParsed  → extract defineAction() calls from AST
//     buildEnd      → (actions accumulated)
//     writeBundle   → combine plugin info + extracted actions → manifest.json
//
// Rollup-specific differences from the Vite plugin:
//   - `onLog` suppresses `MODULE_LEVEL_DIRECTIVE` warnings caused by
//     "use client" directives in React dependencies
//   - `order: "pre"` on resolveId/load ensures font and devtools
//     resolution runs before other plugins
//   - Dev mode detected via `this.meta.watchMode` (no Vite config)
//   - Output dir resolved from `outputOptions.dir` or
//     `dirname(outputOptions.file)` (Rollup supports both forms)
//   - No `closeBundle` restart hook (handled externally for Rollup)

import { dirname, join } from "node:path";
import type { LogLevel, Plugin, NormalizedOutputOptions, PluginContext, RollupLog } from "rollup";
import {
  copyNativeBindings,
  isDevelopmentMode,
  shouldStripDevtools,
  isLibraryDevtoolsImport,
  NOOP_DEVTOOLS_ID,
  NOOP_DEVTOOLS_CODE,
  TAKUMI_NATIVE_LOADER_ID,
  TAKUMI_NATIVE_LOADER_CODE,
  resolvePluginDir,
  deriveCodePath,
} from "./bundler-shared";
import { resolveFontId, loadFont } from "./font-inline";
import {
  validatePluginUUID,
  validateManifestConfig,
  generateManifestJsonString,
  writeManifestIfChanged,
} from "./manifest-gen";
import type { ExtractedAction } from "./manifest-extract";
import { extractActionsFromAST, extractedToActionSource } from "./manifest-extract";

export type {
  StreamDeckPlatform,
  StreamDeckArch,
  StreamDeckTarget,
  StreamDeckTargetOptions,
  TakumiBackend,
} from "./bundler-shared";

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

import type { StreamDeckTargetOptions } from "./bundler-shared";
import type { ManifestConfig, PluginManifestInfo } from "./manifest-types";

export interface StreamDeckRollupOptions extends StreamDeckTargetOptions {
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
   *
   * @example
   * ```ts
   * streamDeckReact({
   *   manifest: {
   *     uuid: "com.example.my-plugin",
   *     name: "My Plugin",
   *     author: "Me",
   *     description: "A plugin",
   *     icon: "imgs/plugin-icon",
   *     version: "1.0.0.0",
   *   },
   * })
   * ```
   */
  manifest?: PluginManifestInfo;
}

/**
 * Rollup plugin for Stream Deck React projects.
 *
 * Same responsibilities as the Vite plugin (see vite.ts) with
 * Rollup-specific differences:
 *
 *   - No `configResolved` — dev mode detected via `this.meta.watchMode`
 *   - `onLog` suppresses `MODULE_LEVEL_DIRECTIVE` warnings (caused by
 *     "use client" directives in React dependencies)
 *   - `moduleParsed` extracts defineAction() metadata from each module
 *   - `writeBundle` generates manifest.json + copies native bindings
 *   - No `closeBundle` restart hook (handled externally)
 *
 * Font inlining and manifest generation are shared via bundler-shared.ts,
 * font-inline.ts, manifest-gen.ts, and manifest-extract.ts.
 */
export function streamDeckReact(options: StreamDeckRollupOptions = {}): Plugin {
  // ── Extracted actions accumulated during build ──────────────────
  // Populated by the moduleParsed hook as each module's AST is
  // scanned for defineAction() calls.
  const extractedActions: ExtractedAction[] = [];

  return {
    name: "fcannizzaro-streamdeck-react",
    onLog(_level: LogLevel, log: RollupLog) {
      if (log.code === "MODULE_LEVEL_DIRECTIVE") return false;
    },

    buildStart(this: PluginContext) {
      // Early validation: plugin UUID format check
      if (options.manifest) {
        const uuidError = validatePluginUUID(options.manifest.uuid);
        if (uuidError) {
          this.warn(
            `[@fcannizzaro/streamdeck-react] ${uuidError.message}`,
          );
        }
      }

      // Clear any stale extracted actions from previous builds (watch mode)
      extractedActions.length = 0;
    },

    // ── Action Extraction ────────────────────────────────────────────
    //
    // Called for every module after all transform hooks have run.
    // We parse the transformed code (valid JS at this point — TypeScript
    // and JSX have been stripped by babel/@vitejs/plugin-react) and
    // walk the AST to find defineAction() calls.
    //
    // Quick string check avoids parsing modules that don't reference
    // defineAction at all.

    moduleParsed(this: PluginContext, moduleInfo) {
      if (!options.manifest) return;
      if (!moduleInfo.code?.includes("defineAction")) return;

      try {
        const ast = this.parse(moduleInfo.code) as unknown as Record<string, unknown>;
        const actions = extractActionsFromAST(ast);

        for (const action of actions) {
          // Skip actions with info.disabled
          if (action.info?.disabled) continue;
          extractedActions.push(action);
        }
      } catch {
        // Parse failure — skip this module silently.
        // This can happen for modules with non-standard syntax that
        // acorn can't handle (rare in practice since babel/esbuild
        // transform runs first).
      }
    },

    resolveId: {
      order: "pre" as const,
      handler(this: PluginContext, source: string, importer: string | undefined) {
        // Strip devtools module in production builds
        if (shouldStripDevtools(this.meta.watchMode) && isLibraryDevtoolsImport(source, importer)) {
          return NOOP_DEVTOOLS_ID;
        }
        // Replace @takumi-rs/core with a lightweight native loader to avoid
        // the inlineDynamicImports ordering issue (see bundler-shared.ts).
        if (options.takumi !== "wasm" && source === "@takumi-rs/core") {
          return TAKUMI_NATIVE_LOADER_ID;
        }
        return resolveFontId(source, importer);
      },
    },
    load: {
      order: "pre" as const,
      handler(id: string) {
        if (id === NOOP_DEVTOOLS_ID) return NOOP_DEVTOOLS_CODE;
        if (id === TAKUMI_NATIVE_LOADER_ID) return TAKUMI_NATIVE_LOADER_CODE;
        return loadFont(id);
      },
    },
    writeBundle(this: PluginContext, outputOptions: NormalizedOutputOptions) {
      const isDevelopment = isDevelopmentMode(this.meta.watchMode);

      const outDir = outputOptions.file ? dirname(outputOptions.file) : outputOptions.dir;
      if (!outDir) return;

      // ── Native bindings ─────────────────────────────────────────
      copyNativeBindings(outDir, isDevelopment, options, (msg) => this.warn(msg));

      // ── Manifest generation ─────────────────────────────────────
      if (options.manifest) {
        const pluginDir = resolvePluginDir(outDir);
        if (!pluginDir) {
          this.warn(
            "[@fcannizzaro/streamdeck-react] Could not resolve .sdPlugin directory from output path. " +
              "Manifest generation skipped.",
          );
          return;
        }

        // Derive CodePath from the bundler output file
        const outFile = outputOptions.file ?? join(outDir, "plugin.mjs");
        const codePath = deriveCodePath(outFile, pluginDir);

        // Build full ManifestConfig from plugin info + extracted actions
        const fullConfig: ManifestConfig = {
          ...options.manifest,
          actions: extractedActions.map(extractedToActionSource),
        };

        // Validate the complete config (action UUID prefixes, duplicates)
        const errors = validateManifestConfig(fullConfig, (msg) => this.warn(msg));
        if (errors.length > 0) {
          this.warn(
            `[@fcannizzaro/streamdeck-react] Manifest validation found ${errors.length} issue(s)`,
          );
        }

        const content = generateManifestJsonString(fullConfig, codePath);
        const manifestPath = join(pluginDir, "manifest.json");
        const written = writeManifestIfChanged(manifestPath, content);

        if (written) {
          console.log(
            `[@fcannizzaro/streamdeck-react] Generated ${manifestPath}`,
          );
        }
      }
    },
  };
}
