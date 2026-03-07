import { builtinModules } from "node:module";
import { resolve } from "node:path";
import { defineConfig, esmExternalRequirePlugin } from "vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from '@rolldown/plugin-babel'
import {
  streamDeckReact,
  type NativeAddonPlatform,
  type NativeAddonArch,
} from "@fcannizzaro/streamdeck-react/vite";

const PLUGIN_DIR = "com.example.react-pokemon.sdPlugin";
const builtins = builtinModules.flatMap((m) => [m, `node:${m}`]);

export default defineConfig({
  resolve: {
    conditions: ["node"],
  },
  plugins: [
    esmExternalRequirePlugin({ external: builtins }),
    react(),
    // @ts-expect-error — @rolldown/plugin-babel@0.2.0 types incorrectly mark inherited babel fields as required
    babel({ presets: [reactCompilerPreset()] }),
    streamDeckReact({
      uuid: "com.example.react-pokemon",
      targets: [
        {
          platform: process.platform as NativeAddonPlatform,
          arch: process.arch as NativeAddonArch,
        },
      ],
    }),
  ],
  build: {
    target: "node20",
    outDir: resolve(PLUGIN_DIR, "bin"),
    emptyOutDir: false,
    sourcemap: true,
    minify: false,
    lib: {
      entry: resolve("src/plugin.ts"),
      formats: ["es"],
      fileName: () => "plugin.mjs",
    },
    rolldownOptions: {
      output: {
        codeSplitting: false,
      },
    },
  },
});
