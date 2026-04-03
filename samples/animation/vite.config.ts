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

const PLUGIN_DIR = "com.example.react-animation.sdPlugin";
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
      targets: [
        {
          platform: process.platform as StreamDeckPlatform,
          arch: process.arch as StreamDeckArch,
        },
      ],
      manifest: {
        uuid: "com.example.react-animation",
        name: "React Animation Sample",
        author: "Francesco Saverio Cannizzaro",
        description:
          "Sample plugin demonstrating useSpring and useTween animation hooks from @fcannizzaro/streamdeck-react.",
        icon: "imgs/plugin-icon",
        version: "0.0.0.1",
        nodejs: { version: "24", debug: "--inspect=127.0.0.1:8092" },
      },
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
