import { builtinModules } from "node:module";
import { babel } from "@rollup/plugin-babel";
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import { streamDeckReact } from "@fcannizzaro/streamdeck-react/rollup";

const PLUGIN_DIR = "com.example.react-counter.sdPlugin";

const builtins = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));

export default {
  input: "src/plugin.ts",
  output: {
    file: `${PLUGIN_DIR}/bin/plugin.mjs`,
    format: "es",
    sourcemap: true,
    inlineDynamicImports: true,
  },
  external: (id) => builtins.has(id),
  plugins: [
    resolve({
      preferBuiltins: true,
      extensions: [".js", ".jsx", ".ts", ".tsx"],
    }),
    commonjs(),
    json(),
    babel({
      babelHelpers: "bundled",
      extensions: [".js", ".jsx", ".ts", ".tsx"],
      exclude: "**/node_modules/**",
      plugins: ["babel-plugin-react-compiler"],
      presets: ["@babel/preset-typescript", ["@babel/preset-react", { runtime: "automatic" }]],
    }),
    streamDeckReact({
      targets: [{ arch: "arm64", platform: "darwin" }],
      manifest: {
        uuid: "com.example.react-counter",
        name: "React Counter Sample",
        author: "Francesco Saverio Cannizzaro",
        description:
          "Sample plugin demonstrating @fcannizzaro/streamdeck-react with counter, timer, toggle, volume, and equalizer touchstrip actions.",
        icon: "imgs/plugin-icon",
        version: "0.0.0.1",
        nodejs: { version: "24", debug: "--inspect=127.0.0.1:8090" },
      },
    }),
  ],
};
