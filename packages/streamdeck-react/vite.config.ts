import { resolve } from "node:path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

const rootDir = resolve(import.meta.dirname);
const srcDir = resolve(rootDir, "src");

const externalPackages = [
  "@elgato/streamdeck",
  "@takumi-rs/core",
  "@takumi-rs/helpers",
  "react",
  "react-reconciler",
  "rollup",
  "typescript",
];

function isExternal(id: string): boolean {
  return (
    id.startsWith("node:") ||
    externalPackages.some((pkg) => id === pkg || id.startsWith(`${pkg}/`))
  );
}

export default defineConfig({
  resolve: {
    alias: {
      "@": srcDir,
    },
  },
  define: {
    "process.env.NODE_ENV": "process.env.NODE_ENV",
  },
  build: {
    target: "node20",
    minify: false,
    lib: {
      entry: {
        index: resolve(srcDir, "index.ts"),
        rollup: resolve(srcDir, "rollup.ts"),
      },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: isExternal,
      output: {
        preserveModules: true,
        preserveModulesRoot: srcDir,
        entryFileNames: "[name].js",
        chunkFileNames: "[name].js",
      },
    },
  },
  plugins: [
    dts({
      tsconfigPath: resolve(rootDir, "tsconfig.build.json"),
      rollupTypes: false,
      entryRoot: srcDir,
      include: [srcDir],
      outDir: resolve(rootDir, "dist"),
      beforeWriteFile: (filePath, content) => ({
        filePath,
        content: content.replace(/(from\s+["'][^"']+?)\.(?:ts|tsx)(["'])/g, "$1.js$2"),
      }),
    }),
  ],
});
