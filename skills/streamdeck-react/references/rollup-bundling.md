# Rollup Bundling

`@fcannizzaro/streamdeck-react` provides the `nativeAddon()` Rollup helper from `@fcannizzaro/streamdeck-react/rollup`.

If the user is starting from scratch, prefer `npm create streamdeck-react@latest` and let the scaffolder generate this config.

## Full Rollup Config Template

```js
// rollup.config.mjs
import { builtinModules } from 'node:module';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import esbuild from 'rollup-plugin-esbuild';
import { nativeAddon } from '@fcannizzaro/streamdeck-react/rollup';

const PLUGIN_DIR = 'com.example.my-plugin.sdPlugin';
const builtins = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));

export default {
  input: 'src/plugin.ts',
  output: {
    file: `${PLUGIN_DIR}/bin/plugin.mjs`,
    format: 'es',
    sourcemap: true,
    inlineDynamicImports: true,
  },
  external: (id) => builtins.has(id),
  plugins: [
    resolve({ preferBuiltins: true }),
    commonjs(),
    json(),
    esbuild({ target: 'node20', jsx: 'automatic' }),
    nativeAddon({
      targets: [{ platform: 'darwin', arch: 'arm64' }],
    }),
  ],
};
```

## Required Build Dependencies

```bash
npm install -D rollup @rollup/plugin-node-resolve @rollup/plugin-commonjs @rollup/plugin-json rollup-plugin-esbuild
```

## Required Runtime Dependencies

```bash
npm install @fcannizzaro/streamdeck-react react ws
```

You also need platform-specific Takumi native binding packages so `nativeAddon({ targets })` can copy the correct `.node` files into your plugin output.

For production builds, always pass explicit `targets`. In watch mode, `nativeAddon()` can infer the current supported host target.

## Plugin Details

### nativeAddon()

Copies the platform-specific `@takumi-rs/core` native binding (`.node` file) into the Rollup output directory. This is **required** -- without it, the plugin will crash on startup because the Takumi renderer can't find its native binary.

```ts
type NativeAddonOptions = {
  targets?: Array<{
    platform: 'darwin' | 'linux' | 'win32';
    arch: 'arm64' | 'x64';
  }>;
};
```

The plugin runs during `writeBundle` and:
1. Uses explicit `targets` when provided.
2. In watch mode, can infer the current supported host target.
3. Resolves the corresponding `@takumi-rs/core-*` packages.
4. Copies the `.node` files to the output directory alongside `plugin.mjs`.
5. Throws for missing or unsupported production targets.

### Supported Platforms

| Platform | Architecture | Package | File |
|----------|-------------|---------|------|
| macOS | arm64 | `core-darwin-arm64` | `core.darwin-arm64.node` |
| macOS | x64 | `core-darwin-x64` | `core.darwin-x64.node` |
| Windows | x64 | `core-win32-x64-msvc` | `core.win32-x64-msvc.node` |
| Windows | arm64 | `core-win32-arm64-msvc` | `core.win32-arm64-msvc.node` |

The current built-in target map covers macOS and Windows presets.

## Output Structure

After building, the `.sdPlugin/bin/` directory should contain:

```
bin/
  plugin.mjs           # Bundled plugin code
  plugin.mjs.map       # Source map
  core.<platform>.node # Native Takumi binding
```

## Plugin Order

The order of Rollup plugins matters:

1. `resolve({ preferBuiltins: true })` -- Node module resolution
2. `commonjs()` -- CJS to ESM conversion
3. `json()` -- JSON imports
4. `esbuild({ target: 'node20', jsx: 'automatic' })` -- TypeScript/JSX compilation
5. `nativeAddon({ targets })` -- copies native binaries (conventionally last)

## Key Configuration Notes

- **`format: 'es'`** -- ESM output is required for the Stream Deck Node.js runtime.
- **`inlineDynamicImports: true`** -- bundles everything into a single file.
- **`external`** -- Node.js builtins must be externalized (they're available in the runtime).
- **`target: 'node20'`** -- matches the Stream Deck plugin runtime.
- **`jsx: 'automatic'`** -- uses the React JSX transform (no manual `import React`).
- **No `resolveLibraryPaths()`** -- user projects do not need it anymore.

## Watch Mode (Development)

```bash
npx rollup -c -w
```

With the Elgato CLI installed, combine with auto-restart:

```bash
bunx --bun rollup -c -w --watch.onEnd="streamdeck restart com.example.my-plugin"
```
