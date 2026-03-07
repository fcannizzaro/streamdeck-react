import { exec } from "node:child_process";
import { resolve } from "node:path";
import type { Plugin, ResolvedConfig } from "vite";
import { copyNativeBindings } from "./native-addon-shared.ts";
import type { NativeAddonTarget, NativeAddonOptions } from "./native-addon-shared.ts";

export type {
  NativeAddonPlatform,
  NativeAddonArch,
  NativeAddonLibc,
  NativeAddonTarget,
  NativeAddonOptions,
} from "./native-addon-shared.ts";

export interface StreamDeckReactOptions extends NativeAddonOptions {
  /**
   * The plugin UUID used to restart the plugin after each build
   * (e.g. `"com.example.react-pokemon"`).
   *
   * When set, the plugin will run `streamdeck restart <uuid>` after
   * each successful build.
   */
  uuid?: string;
}

/**
 * Vite plugin for Stream Deck React projects.
 *
 * - Copies platform-specific `@takumi-rs/core` native bindings (`.node` files)
 *   into the bundle output directory.
 * - Optionally restarts the Stream Deck plugin after each build when
 *   {@link StreamDeckReactOptions.uuid} is provided.
 */
export function streamDeckReact(options: StreamDeckReactOptions = {}): Plugin {
  let resolvedConfig: ResolvedConfig;

  return {
    name: "fcannizzaro-streamdeck-react",
    apply: "build",

    configResolved(config) {
      resolvedConfig = config;
    },

    writeBundle() {
      const isWatch = resolvedConfig.build.watch !== null;
      const isDevelopment = isWatch || process.env.NODE_ENV === "development";
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
