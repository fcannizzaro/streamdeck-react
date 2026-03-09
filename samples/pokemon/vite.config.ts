import { builtinModules } from "node:module";
import { resolve } from "node:path";
import { defineConfig, esmExternalRequirePlugin } from "vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import {
  streamDeckReact,
  type StreamDeckPlatform,
  type StreamDeckArch,
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
    babel({ presets: [reactCompilerPreset()] }),
    streamDeckReact({
      uuid: "com.example.react-pokemon",
      targets: [
        {
          platform: process.platform as StreamDeckPlatform,
          arch: process.arch as StreamDeckArch,
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
