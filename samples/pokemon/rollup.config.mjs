import { builtinModules } from "node:module";
import { babel } from "@rollup/plugin-babel";
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import { nativeAddon } from "@fcannizzaro/streamdeck-react/rollup";

const PLUGIN_DIR = "com.example.react-pokemon.sdPlugin";

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
    }),
    commonjs(),
    json(),
    babel({
      babelHelpers: "bundled",
      extensions: [".js", ".jsx", ".ts", ".tsx"],
      exclude: "**/node_modules/**",
      plugins: ["babel-plugin-react-compiler"],
      presets: [
        "@babel/preset-typescript",
        ["@babel/preset-react", { runtime: "automatic" }],
      ],
    }),
    nativeAddon(),
  ],
};
