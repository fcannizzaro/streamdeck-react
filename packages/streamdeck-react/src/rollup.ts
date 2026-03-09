import { dirname } from "node:path";
import type { LogLevel, Plugin, NormalizedOutputOptions, PluginContext, RollupLog } from "rollup";
import {
  copyNativeBindings,
  isDevelopmentMode,
  shouldStripDevtools,
  isLibraryDevtoolsImport,
  NOOP_DEVTOOLS_ID,
  NOOP_DEVTOOLS_CODE,
} from "./native-addon-shared";
import { resolveFontId, loadFont } from "./font-inline";

export type {
  NativeAddonPlatform,
  NativeAddonArch,
  NativeAddonLibc,
  NativeAddonTarget,
  NativeAddonOptions,
} from "./native-addon-shared";

import type { NativeAddonOptions } from "./native-addon-shared";

/**
 * Rollup plugin that copies the `@takumi-rs/core` platform-specific native
 * binding (`.node` file) into the bundle output directory so the Stream Deck
 * Node.js runtime can find it at startup.
 *
 * Font files (`.ttf`, `.otf`, `.woff`, `.woff2`) imported by the project are
 * automatically inlined into the bundle as `Buffer` instances so no runtime
 * filesystem access is needed.
 *
 * In production builds (non-watch mode), the devtools module is replaced with
 * a noop stub so the entire devtools tree and `ws` dependency are eliminated.
 */
export function nativeAddon(options: NativeAddonOptions = {}): Plugin {
  return {
    name: "fcannizzaro-streamdeck-react-native-addon",
    onLog(_level: LogLevel, log: RollupLog) {
      if (log.code === "MODULE_LEVEL_DIRECTIVE") return false;
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
