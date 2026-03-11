// ── Rollup Plugin for Stream Deck React ─────────────────────────────
//
// Rollup counterpart of the Vite plugin (vite.ts).  Handles the same
// four build-time concerns via shared infrastructure:
//
//   1. Font inlining       — .ttf/.otf/.woff/.woff2 → base64 Buffer
//   2. Native bindings     — copy Takumi .node to output directory
//   3. Devtools stripping  — replace devtools import with noop in production
//   4. Manifest codegen    — manifest.json → streamdeck-env.d.ts
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

import { dirname, resolve } from "node:path";
import type { LogLevel, Plugin, NormalizedOutputOptions, PluginContext, RollupLog } from "rollup";
import {
  copyNativeBindings,
  isDevelopmentMode,
  shouldStripDevtools,
  isLibraryDevtoolsImport,
  NOOP_DEVTOOLS_ID,
  NOOP_DEVTOOLS_CODE,
} from "./bundler-shared";
import { resolveFontId, loadFont } from "./font-inline";
import { generateManifestTypes } from "./manifest-codegen";

export type {
  StreamDeckPlatform,
  StreamDeckArch,
  StreamDeckTarget,
  StreamDeckTargetOptions,
} from "./bundler-shared";

import type { StreamDeckTargetOptions } from "./bundler-shared";

export interface StreamDeckRollupOptions extends StreamDeckTargetOptions {
  /**
   * Path to the plugin `manifest.json`. When omitted, the plugin
   * auto-detects by scanning the project root for a `*.sdPlugin/manifest.json`.
   *
   * Set to `false` to disable manifest type generation entirely.
   */
  manifest?: string | false;
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
 *   - `buildStart` resolves root via `resolve(".")` (no Vite config)
 *   - `writeBundle` reads output dir from `outputOptions.dir` or
 *     `dirname(outputOptions.file)` (Rollup supports both)
 *   - No `closeBundle` restart hook (handled externally)
 *
 * Font inlining and manifest codegen are shared via bundler-shared.ts,
 * font-inline.ts, and manifest-codegen.ts.
 */
export function streamDeckReact(options: StreamDeckRollupOptions = {}): Plugin {
  return {
    name: "fcannizzaro-streamdeck-react",
    onLog(_level: LogLevel, log: RollupLog) {
      if (log.code === "MODULE_LEVEL_DIRECTIVE") return false;
    },
    buildStart(this: PluginContext) {
      const root = resolve(".");
      const warn = (msg: string) => this.warn(msg);
      const result = generateManifestTypes(root, options.manifest, warn);

      if (result) {
        // Watch manifest.json so changes trigger a rebuild in watch mode
        this.addWatchFile(result.manifestPath);

        if (result.written) {
          console.log("[@fcannizzaro/streamdeck-react] Generated src/streamdeck-env.d.ts");
        }
      }
    },
    resolveId: {
      order: "pre" as const,
      handler(this: PluginContext, source: string, importer: string | undefined) {
        // Strip devtools module in production builds
        if (shouldStripDevtools(this.meta.watchMode) && isLibraryDevtoolsImport(source, importer)) {
          return NOOP_DEVTOOLS_ID;
        }
        return resolveFontId(source, importer);
      },
    },
    load: {
      order: "pre" as const,
      handler(id: string) {
        if (id === NOOP_DEVTOOLS_ID) return NOOP_DEVTOOLS_CODE;
        return loadFont(id);
      },
    },
    writeBundle(this: PluginContext, outputOptions: NormalizedOutputOptions) {
      const isDevelopment = isDevelopmentMode(this.meta.watchMode);

      const outDir = outputOptions.file ? dirname(outputOptions.file) : outputOptions.dir;
      if (!outDir) return;

      copyNativeBindings(outDir, isDevelopment, options, (msg) => this.warn(msg));
    },
  };
}
