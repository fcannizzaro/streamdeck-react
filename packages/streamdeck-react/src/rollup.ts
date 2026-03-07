import { dirname } from "node:path";
import type { LogLevel, Plugin, NormalizedOutputOptions, PluginContext, RollupLog } from "rollup";
import { copyNativeBindings, isDevelopmentMode } from "./native-addon-shared.ts";

export type {
  NativeAddonPlatform,
  NativeAddonArch,
  NativeAddonLibc,
  NativeAddonTarget,
  NativeAddonOptions,
} from "./native-addon-shared.ts";

import type { NativeAddonOptions } from "./native-addon-shared.ts";

/**
 * Rollup plugin that copies the `@takumi-rs/core` platform-specific native
 * binding (`.node` file) into the bundle output directory so the Stream Deck
 * Node.js runtime can find it at startup.
 */
export function nativeAddon(options: NativeAddonOptions = {}): Plugin {
  return {
    name: "fcannizzaro-streamdeck-react-native-addon",
    onLog(_level: LogLevel, log: RollupLog) {
      if (log.code === "MODULE_LEVEL_DIRECTIVE") return false;
    },
    writeBundle(this: PluginContext, outputOptions: NormalizedOutputOptions) {
      const isDevelopment = isDevelopmentMode(this.meta.watchMode);

      const outDir = outputOptions.file ? dirname(outputOptions.file) : outputOptions.dir;
      if (!outDir) return;

      copyNativeBindings(outDir, isDevelopment, options, (msg) => this.warn(msg));
    },
  };
}
