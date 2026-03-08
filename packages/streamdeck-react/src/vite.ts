import { exec } from "node:child_process";
import { resolve } from "node:path";
import type { Plugin, ResolvedConfig } from "vite";
import { copyNativeBindings, shouldStripDevtools, isLibraryDevtoolsImport, NOOP_DEVTOOLS_ID, NOOP_DEVTOOLS_CODE } from "./native-addon-shared";
import { resolveFontId, loadFont } from "./font-inline";
import type { NativeAddonTarget, NativeAddonOptions } from "./native-addon-shared";

export type {
  NativeAddonPlatform,
  NativeAddonArch,
  NativeAddonLibc,
  NativeAddonTarget,
  NativeAddonOptions,
} from "./native-addon-shared";

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
 * - Inlines font files (`.ttf`, `.otf`, `.woff`, `.woff2`) imported by the
 *   project into the bundle as `Buffer` instances so no runtime filesystem
 *   access is needed.
 * - Copies platform-specific `@takumi-rs/core` native bindings (`.node` files)
 *   into the bundle output directory.
 * - Strips devtools code in production builds (non-watch mode).
 * - Optionally restarts the Stream Deck plugin after each build when
 *   {@link StreamDeckReactOptions.uuid} is provided.
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
