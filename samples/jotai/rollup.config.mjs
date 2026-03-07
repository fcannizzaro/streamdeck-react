import { builtinModules } from "node:module";
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import esbuild from "rollup-plugin-esbuild";
import { nativeAddon } from "@fcannizzaro/streamdeck-react/rollup";

const PLUGIN_DIR = "com.example.react-jotai.sdPlugin";

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
    esbuild({
      target: "node20",
      jsx: "automatic",
    }),
    nativeAddon(),
  ],
};
