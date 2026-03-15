// ── Vite Plugin for Stream Deck React ───────────────────────────────
//
// Wraps the shared build infrastructure (bundler-shared.ts) into Vite's
// plugin lifecycle.  Compared to the Rollup plugin (rollup.ts):
//
//   - Uses `configResolved` to detect watch/dev mode (Rollup uses
//     `this.meta.watchMode`)
//   - Adds `closeBundle` hook to auto-restart the Stream Deck plugin
//     via `streamdeck restart <uuid>` after each build
//   - `apply: "build"` ensures this plugin is excluded from Vite's
//     dev server (HMR is not applicable — Stream Deck plugins are
//     standalone Node.js processes, not browser tabs)
//   - `enforce: "pre"` ensures font resolution and devtools stripping
//     run before other plugins that might resolve the same imports
//
// Manifest generation (code-first, zero-config for actions):
//
//   Action metadata is defined in defineAction({ info: { ... } }) and
//   auto-extracted from the module graph during the build.  The bundler
//   plugin's `manifest` option only contains plugin-level info.
//
//   Pipeline:
//     moduleParsed  → extract defineAction() calls from AST
//     writeBundle   → combine plugin info + extracted actions → manifest.json
//     closeBundle   → restart Stream Deck plugin

import { exec } from "node:child_process";
import { join, resolve } from "node:path";
import type { Plugin, ResolvedConfig } from "vite";
import {
  copyNativeBindings,
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
import type { StreamDeckTargetOptions } from "./bundler-shared";
import type { ManifestConfig, PluginManifestInfo } from "./manifest-types";

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

/**
 * Vite plugin for Stream Deck React projects.
 *
 * Responsibilities mapped to Vite lifecycle hooks:
 *
 *   configResolved  → detect dev/production mode, set strip flags
 *   buildStart      → validate plugin UUID format (early check)
 *   moduleParsed    → extract defineAction() metadata from each module
 *   resolveId       → redirect devtools imports (production) + font imports
 *   load            → return noop devtools stub + inline font as base64 Buffer
 *   writeBundle     → copy native .node bindings + generate manifest.json
 *   closeBundle     → restart Stream Deck plugin (optional, via CLI)
 *
 * Font inlining:
 *   `.ttf`, `.otf`, `.woff`, `.woff2` imports are resolved to absolute
 *   paths and loaded as synthetic ES modules:
 *     `export default Buffer.from("<base64>", "base64");`
 *   This eliminates runtime filesystem access in the sandboxed
 *   Stream Deck Node.js environment.
 */
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
          resolvedConfig.logger.warn(
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
      // the inlineDynamicImports ordering issue (see bundler-shared.ts).
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
          resolvedConfig.logger.info(
            `[@fcannizzaro/streamdeck-react] Generated ${manifestPath}`,
          );
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
