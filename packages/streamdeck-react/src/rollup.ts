import { dirname } from "node:path";
import type { LogLevel, Plugin, NormalizedOutputOptions, PluginContext, RollupLog } from "rollup";
import { copyNativeBindings, isDevelopmentMode } from "./native-addon-shared";
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
 */
export function nativeAddon(options: NativeAddonOptions = {}): Plugin {
  return {
    name: "fcannizzaro-streamdeck-react-native-addon",
    onLog(_level: LogLevel, log: RollupLog) {
      if (log.code === "MODULE_LEVEL_DIRECTIVE") return false;
    },
    resolveId(source, importer) {
      return resolveFontId(source, importer);
    },
    load(id) {
      return loadFont(id);
    },
    writeBundle(this: PluginContext, outputOptions: NormalizedOutputOptions) {
      const isDevelopment = isDevelopmentMode(this.meta.watchMode);

      const outDir = outputOptions.file ? dirname(outputOptions.file) : outputOptions.dir;
      if (!outDir) return;

      copyNativeBindings(outDir, isDevelopment, options, (msg) => this.warn(msg));
    },
  };
}
