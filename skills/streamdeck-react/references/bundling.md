# Bundling

`@fcannizzaro/streamdeck-react` uses **Vite 8 with Rolldown** via `@fcannizzaro/streamdeck-react/vite` which provides `streamDeckReact()`.

If the user is starting from scratch, prefer `npm create streamdeck-react@latest` and let the scaffolder generate the config.

## Vite Config Templates

### Default (Oxc transforms)

```ts
// vite.config.ts
import { builtinModules } from "node:module";
import { resolve } from "node:path";
import { defineConfig, esmExternalRequirePlugin } from "vite";
import react from "@vitejs/plugin-react";
import { streamDeckReact } from "@fcannizzaro/streamdeck-react/vite";

const PLUGIN_DIR = "com.example.my-plugin.sdPlugin";
const builtins = builtinModules.flatMap((m) => [m, `node:${m}`]);

export default defineConfig({
  resolve: {
    conditions: ["node"],
  },
  plugins: [
    esmExternalRequirePlugin({ external: builtins }),
    react(),
    streamDeckReact({
      uuid: "com.example.my-plugin",
      manifest: {
        uuid: "com.example.my-plugin",
        name: "My Plugin",
        author: "Your Name",
        description: "A Stream Deck plugin.",
        icon: "imgs/plugin-icon",
        version: "0.0.0.1",
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
```

### With React Compiler

When the user opts into React Compiler during scaffolding (`--react-compiler true`), the Babel plugin is added on top of the default config. The compiler automatically memoizes components at build time, preventing unnecessary re-renders and the expensive rasterization pipeline they trigger.

```ts
// vite.config.ts
import { builtinModules } from "node:module";
import { resolve } from "node:path";
import { defineConfig, esmExternalRequirePlugin } from "vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import { streamDeckReact } from "@fcannizzaro/streamdeck-react/vite";

const PLUGIN_DIR = "com.example.my-plugin.sdPlugin";
const builtins = builtinModules.flatMap((m) => [m, `node:${m}`]);

export default defineConfig({
  resolve: {
    conditions: ["node"],
  },
  plugins: [
    esmExternalRequirePlugin({ external: builtins }),
    react(),
    // @ts-expect-error — @rolldown/plugin-babel types incorrectly mark inherited babel fields as required
    await babel({
      presets: [reactCompilerPreset()],
    }),
    streamDeckReact({
      uuid: "com.example.my-plugin",
      manifest: {
        uuid: "com.example.my-plugin",
        name: "My Plugin",
        author: "Your Name",
        description: "A Stream Deck plugin.",
        icon: "imgs/plugin-icon",
        version: "0.0.0.1",
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
```

## Required Build Dependencies

**Default**:

```bash
npm install -D vite@8.0.0 @vitejs/plugin-react@6.0.1
```

**With React Compiler**:

```bash
npm install -D vite@8.0.0 @vitejs/plugin-react@6.0.1 @rolldown/plugin-babel @babel/core babel-plugin-react-compiler
```

## Required Runtime Dependencies

```bash
npm install @fcannizzaro/streamdeck-react react ws
```

## Native Binding Strategy

By default, native Takumi `.node` binaries are **lazy-loaded at runtime**. On first plugin startup, the binary matching the current `process.platform`/`process.arch` is downloaded from npm and cached on disk next to the bundle output. Subsequent loads use the cached file with zero network overhead.

No platform-specific `@takumi-rs/core-*` packages need to be installed. The installed version of the main `@takumi-rs/core` package (included as a dependency) is resolved at build time and baked into the generated loader.

### Opting into Copy Mode

To revert to the previous behavior of copying `.node` files from `node_modules` at build time, set `nativeBindings: "copy"` and install the matching platform packages:

```ts
streamDeckReact({
  nativeBindings: "copy",
  targets: [{ platform: "darwin", arch: "arm64" }],
  manifest: { ... },
})
```

```bash
npm install @takumi-rs/core-darwin-arm64
```

## Plugin Details

### streamDeckReact()

Handles build-time concerns:

1. **Native bindings**: By default, generates a lazy-loader virtual module that downloads the platform-specific `.node` file from npm at runtime. When `nativeBindings: "copy"`, copies binaries from `node_modules` instead (requires `targets`). When `takumi: "wasm"`, skipped entirely.

2. **Manifest generation**: Auto-generates `manifest.json` from the `manifest` option (plugin info) and `defineAction({ info })` calls (action info extracted via AST analysis at build time).

```ts
type StreamDeckReactOptions = {
  targets?: Array<{
    platform: "darwin" | "win32";
    arch: "arm64" | "x64";
  }>;
  takumi?: "native-binding" | "wasm";
  nativeBindings?: "lazy" | "copy"; // Default: "lazy"
  manifest?: PluginManifestInfo;
  uuid?: string;
};

interface PluginManifestInfo {
  uuid: string; // Plugin UUID (reverse-DNS)
  name: string; // Plugin display name
  author: string; // Author name
  description: string; // Plugin description
  icon: string; // Plugin icon path (extension omitted)
  version: string; // Plugin version (e.g. "1.0.0.0")
  // Optional overrides (all have sensible defaults):
  category?: string; // Default: same as name
  categoryIcon?: string; // Default: same as icon
  url?: string;
  supportUrl?: string;
  codePath?: string; // Default: derived from bundler output
  os?: [ManifestOSInfo, ManifestOSInfo?]; // Default: mac 13+ & windows 10+
  nodejs?: ManifestNodejsInfo; // Default: { version: "24" }
  sdkVersion?: 2 | 3; // Default: 2
  software?: { minimumVersion: string }; // Default: "7.1"
  profiles?: ManifestProfileInfo[];
  applicationsToMonitor?: { mac?: string[]; windows?: string[] };
  defaultWindowSize?: [number, number];
  propertyInspectorPath?: string;
  codePathMac?: string;
  codePathWin?: string;
}
```

The plugin runs during the build and:

1. In lazy mode (default): resolves the installed `@takumi-rs/core` version and generates a virtual module with download-on-demand logic. At runtime, the `.node` file is fetched from npm, extracted from the tarball, and cached.
2. In copy mode (`nativeBindings: "copy"`): uses explicit `targets` to locate and copy `.node` files from `node_modules`.
3. Generates `manifest.json` from the `manifest` option and extracted action metadata.
4. Throws for missing bindings in copy mode production builds.

### Supported Platforms

| Platform | Architecture | Package                 | File                         |
| -------- | ------------ | ----------------------- | ---------------------------- |
| macOS    | arm64        | `core-darwin-arm64`     | `core.darwin-arm64.node`     |
| macOS    | x64          | `core-darwin-x64`       | `core.darwin-x64.node`       |
| Windows  | x64          | `core-win32-x64-msvc`   | `core.win32-x64-msvc.node`   |
| Windows  | arm64        | `core-win32-arm64-msvc` | `core.win32-arm64-msvc.node` |

The current built-in target map covers macOS and Windows presets.

## Output Structure

After building, the `.sdPlugin/bin/` directory should contain:

```
bin/
  plugin.mjs           # Bundled plugin code
  plugin.mjs.map       # Source map
```

When using `nativeBindings: "copy"`, the output also includes:

```
bin/
  core.<platform>.node # Native Takumi binding (copy mode only)
```

With the default lazy mode, the `.node` file appears after the plugin's first startup (downloaded and cached automatically).

## Key Configuration Notes

- **`resolve.conditions: ['node']`** -- required so packages like `ws` resolve to their Node.js implementation instead of browser stubs.
- **`esmExternalRequirePlugin({ external: builtins })`** -- converts CJS `require()` calls for Node.js builtins to ESM `import` statements. Without this, bundled CJS code (e.g. `ws`) will crash at runtime because `require` is unavailable in ESM.
- **`build.rolldownOptions`** -- Rolldown-specific output configuration.
- **`codeSplitting: false`** -- bundles everything into a single file.
- **`streamDeckReact()`** -- handles native binding loading (lazy by default) and optional plugin restart. Pass `uuid` to auto-restart after each build.
- **Manifest `Nodejs.Version`** should be `"24"` for all plugins.

## Watch Mode (Development)

```bash
npx vite build --watch
```

The `streamDeckReact({ uuid })` plugin automatically restarts the Stream Deck plugin after each build.
