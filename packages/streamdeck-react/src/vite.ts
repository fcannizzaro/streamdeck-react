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

import { exec } from "node:child_process";
import { resolve } from "node:path";
import type { Plugin, ResolvedConfig } from "vite";
import {
  copyNativeBindings,
  shouldStripDevtools,
  isLibraryDevtoolsImport,
  NOOP_DEVTOOLS_ID,
  NOOP_DEVTOOLS_CODE,
} from "./bundler-shared";
import { resolveFontId, loadFont } from "./font-inline";
import { generateManifestTypes } from "./manifest-codegen";
import type { StreamDeckTarget, StreamDeckTargetOptions } from "./bundler-shared";

export type {
  StreamDeckPlatform,
  StreamDeckArch,
  StreamDeckTarget,
  StreamDeckTargetOptions,
} from "./bundler-shared";

export interface StreamDeckReactOptions extends StreamDeckTargetOptions {
  /**
   * The plugin UUID used to restart the plugin after each build
   * (e.g. `"com.example.react-pokemon"`).
   *
   * When set, the plugin will run `streamdeck restart <uuid>` after
   * each successful build.
   */
  uuid?: string;

  /**
   * Path to the plugin `manifest.json`. When omitted, the plugin
   * auto-detects by scanning the project root for a `*.sdPlugin/manifest.json`.
   *
   * Set to `false` to disable manifest type generation entirely.
   */
  manifest?: string | false;
}

/**
 * Vite plugin for Stream Deck React projects.
 *
 * Responsibilities mapped to Vite lifecycle hooks:
 *
 *   configResolved  → detect dev/production mode, set strip flags
 *   buildStart      → generate streamdeck-env.d.ts from manifest.json
 *   resolveId       → redirect devtools imports (production) + font imports
 *   load            → return noop devtools stub + inline font as base64 Buffer
 *   writeBundle     → copy native .node bindings to output directory
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
      const warn = (msg: string) => resolvedConfig.logger.warn(msg);
      const result = generateManifestTypes(resolvedConfig.root, options.manifest, warn);

      if (result) {
        // Watch manifest.json so changes trigger a rebuild in watch mode
        this.addWatchFile(result.manifestPath);

        if (result.written) {
          resolvedConfig.logger.info(
            "[@fcannizzaro/streamdeck-react] Generated src/streamdeck-env.d.ts",
          );
        }
      }
    },

    resolveId(source, importer) {
      // Strip devtools module in production builds
      if (stripDevtools && isLibraryDevtoolsImport(source, importer)) {
        return NOOP_DEVTOOLS_ID;
      }
      return resolveFontId(source, importer);
    },

    load(id) {
      if (id === NOOP_DEVTOOLS_ID) return NOOP_DEVTOOLS_CODE;
      return loadFont(id);
    },

    writeBundle() {
      const outDir = resolve(resolvedConfig.root, resolvedConfig.build.outDir);

      copyNativeBindings(outDir, isDevelopment, options, (msg) => {
        resolvedConfig.logger.warn(msg);
      });
    },

    closeBundle() {
      if (!options.uuid) return;

      exec(`streamdeck restart ${options.uuid}`, (err) => {
        if (err) {
          console.warn(`[streamdeck-restart] ${err.message}`);
        }
      });
    },
  };
}
