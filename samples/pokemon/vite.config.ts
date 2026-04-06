import { builtinModules } from "node:module";
import { resolve } from "node:path";
import { defineConfig, esmExternalRequirePlugin } from "vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import { streamDeckReact } from "@fcannizzaro/streamdeck-react/vite";

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
      manifest: {
        uuid: "com.example.react-pokemon",
        name: "React Pokemon Sample",
        author: "Francesco Saverio Cannizzaro",
        description:
          "Sample plugin demonstrating @fcannizzaro/streamdeck-react with TanStack React Query and the PokeAPI.",
        icon: "imgs/plugin-icon",
        version: "0.0.0.1",
        nodejs: { version: "24", debug: "--inspect=127.0.0.1:8093" },
      },
    }),
  ],
  build: {
    target: "node20",
    outDir: resolve(PLUGIN_DIR, "bin"),
    emptyOutDir: false,
    sourcemap: false,
    minify: true,
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
