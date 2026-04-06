import { builtinModules } from "node:module";
import { resolve } from "node:path";
import { defineConfig, esmExternalRequirePlugin } from "vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { streamDeckReact } from "@fcannizzaro/streamdeck-react/vite";

const PLUGIN_DIR = "com.example.react-basic.sdPlugin";
const builtins = builtinModules.flatMap((m) => [m, `node:${m}`]);

export default defineConfig({
  resolve: {
    conditions: ["node"],
  },
  plugins: [
    esmExternalRequirePlugin({ external: builtins }),
    tailwindcss(),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    streamDeckReact({
      nativeModules: [
        {
          importSpecifier: "@nativewindow/webview",
          bindings: {
            "darwin-arm64": {
              pkg: "webview-darwin-arm64",
              file: "native-window.darwin-arm64.node",
            },
            "darwin-x64": { pkg: "webview-darwin-x64", file: "native-window.darwin-x64.node" },
            "win32-x64": {
              pkg: "webview-win32-x64-msvc",
              file: "native-window.win32-x64-msvc.node",
            },
            "win32-arm64": {
              pkg: "webview-win32-arm64-msvc",
              file: "native-window.win32-arm64-msvc.node",
            },
          },
          exports: ["NativeWindow", "checkRuntime", "ensureRuntime", "loadHtmlOrigin"],
        },
      ],
      manifest: {
        uuid: "com.example.react-basic",
        name: "React Basic Sample",
        author: "Francesco Saverio Cannizzaro",
        description:
          "Sample plugin demonstrating @fcannizzaro/streamdeck-react with counter, timer, toggle, volume, equalizer touchstrip, and CSS theme actions.",
        icon: "imgs/plugin-icon",
        version: "0.0.0.1",
        nodejs: { version: "24", debug: "--inspect=127.0.0.1:8090" },
      },
    }),
  ],
  build: {
    target: "node20",
    outDir: resolve(PLUGIN_DIR, "bin"),
    emptyOutDir: false,
    sourcemap: true,
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
