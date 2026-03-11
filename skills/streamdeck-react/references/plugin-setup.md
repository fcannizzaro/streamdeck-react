# Plugin Setup

For brand new projects, prefer `npm create streamdeck-react@latest` and customize the generated scaffold before hand-writing setup files.

## createPlugin(config)

Creates the plugin runtime. Must be called once in your entry file.

```ts
import { createPlugin } from '@fcannizzaro/streamdeck-react';

const plugin = createPlugin({
  fonts: [...],
  actions: [...],
});

await plugin.connect();
```

### PluginConfig

```ts
interface PluginConfig {
  fonts: FontConfig[];
  actions: ActionDefinition[];
  wrapper?: WrapperComponent;
  renderDebounceMs?: number; // Default: 16 (~60fps ceiling)
  imageFormat?: "png" | "webp"; // Default: 'png'
  caching?: boolean; // Default: true
  devicePixelRatio?: number; // Default: 1
  onActionError?: (uuid: string, actionId: string, error: Error) => void;
  devtools?: boolean; // Default: false
  debug?: boolean; // Default: NODE_ENV !== 'production'
  imageCacheMaxBytes?: number; // Default: 16777216 (16 MB)
  touchstripCacheMaxBytes?: number; // Default: 8388608 (8 MB)
  useWorker?: boolean; // Default: true
  touchstripImageFormat?: "webp" | "png"; // Default: 'webp'
}
```

| Field                     | Required | Description                                                                                       |
| ------------------------- | -------- | ------------------------------------------------------------------------------------------------- |
| `fonts`                   | Yes      | At least one font file. See FontConfig below.                                                     |
| `actions`                 | Yes      | Array of action definitions from `defineAction()`.                                                |
| `wrapper`                 | No       | Component that wraps ALL action roots. Use for global providers.                                  |
| `renderDebounceMs`        | No       | Coalesces renders. Increase for dial-heavy UIs.                                                   |
| `imageFormat`             | No       | Output format. PNG is default and most compatible.                                                |
| `caching`                 | No       | Output hash caching (xxHash-wasm) to skip duplicate `setImage()` calls.                           |
| `devicePixelRatio`        | No       | Device pixel ratio used by the Takumi renderer. Default: `1`.                                     |
| `onActionError`           | No       | Called when a component throws in any action root.                                                |
| `devtools`                | No       | Enable the devtools server. Port derived from plugin UUID (39400-39499).                          |
| `debug`                   | No       | Enable render counters, duplicate detection, and depth warnings. Defaults to non-production.      |
| `imageCacheMaxBytes`      | No       | Max bytes for the key/dial image cache (LRU). Set to 0 to disable. Default: 16 MB.                |
| `touchstripCacheMaxBytes` | No       | Max bytes for the touchstrip raw buffer cache (LRU). Set to 0 to disable. Default: 8 MB.          |
| `useWorker`               | No       | Offload Takumi rendering to a worker thread. Transparent fallback if worker fails.                |
| `touchstripImageFormat`   | No       | Touchstrip segment encoding format. `"webp"` is faster (native Takumi encode). Default: `"webp"`. |

### Plugin-Level Wrapper

Wraps every action root. Use for global state providers:

```tsx
const plugin = createPlugin({
  fonts: [...],
  actions: [...],
  wrapper: ({ children }) => <MyGlobalProvider>{children}</MyGlobalProvider>,
});
```

### connect()

Must be called after `createPlugin()` and must be the last call in the entry file. It calls `streamDeck.connect()` to establish the WebSocket connection with the Stream Deck software.

Action registration, font initialization, renderer setup, and global settings loading all happen during the `createPlugin()` call itself -- `connect()` only opens the connection.

## defineAction(config)

Maps a manifest UUID to React components.

```ts
import { defineAction } from "@fcannizzaro/streamdeck-react";

export const myAction = defineAction({
  uuid: "com.example.plugin.my-action",
  key: MyKeyComponent,
});
```

### ActionConfig

```ts
interface ActionConfig<S extends JsonObject = JsonObject> {
  uuid: string;
  key?: ComponentType;
  dial?: ComponentType;
  touchStrip?: ComponentType;
  touchStripFPS?: number;
  dialLayout?: EncoderLayout;
  wrapper?: WrapperComponent;
  defaultSettings?: Partial<S>;
}
```

| Field             | Required | Description                                                                                                                   |
| ----------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `uuid`            | Yes      | Must exactly match the `UUID` in `manifest.json`.                                                                             |
| `key`             | No       | Component for key (Keypad controller).                                                                                        |
| `dial`            | No       | Component for encoder display (Stream Deck+). Falls back to `key` if not provided.                                            |
| `touchStrip`      | No       | Full-strip touchstrip component. Replaces per-encoder `dial` with a single shared React tree spanning the entire touch strip. |
| `touchStripFPS`   | No       | Target FPS for the touchstrip animation loop and render pipeline. Default: `60`.                                              |
| `dialLayout`      | No       | Encoder feedback layout. Defaults to a full-width canvas `pixmap` layout keyed as `canvas`.                                   |
| `wrapper`         | No       | Component that wraps this action's root (nested inside plugin wrapper).                                                       |
| `defaultSettings` | No       | Default settings shallow-merged with stored settings.                                                                         |

### Typed Settings

Pass a type parameter for type-safe settings:

```tsx
type VolumeSettings = { volume: number; muted: boolean };

export const volumeAction = defineAction<VolumeSettings>({
  uuid: "com.example.plugin.volume",
  key: VolumeKey,
  dial: VolumeDial,
  dialLayout: "$A1",
  defaultSettings: { volume: 50, muted: false },
});

// In components:
const [settings, setSettings] = useSettings<VolumeSettings>();
```

## FontConfig

```ts
interface FontConfig {
  name: string;
  data: ArrayBuffer | Buffer;
  weight: 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
  style: "normal" | "italic";
}
```

### Loading Fonts

The recommended approach is to install a `@fontsource` or `@fontsource-variable` package and import the font file directly. The bundler plugin (`streamDeckReact()`) inlines the font data as a `Buffer` at build time.

```ts
import InterRegular from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2";

const fonts: FontConfig[] = [
  {
    name: "Inter",
    data: InterRegular,
    weight: 400,
    style: "normal",
  },
];
```

You can also load fonts manually via `readFile` if needed:

```ts
import { readFile } from "node:fs/promises";

const fonts: FontConfig[] = [
  {
    name: "Inter",
    data: await readFile("./fonts/Inter-Regular.ttf"),
    weight: 400,
    style: "normal",
  },
];
```

### Font Rules

- At least one font is required in `createPlugin()`.
- Supported formats: `.ttf`, `.otf`, `.woff`, `.woff2`.
- The renderer cannot access system fonts. Every font used must be explicitly loaded.
- Font is matched by `fontFamily`, `fontWeight`, and `fontStyle`. If the requested weight isn't loaded, the nearest available weight is used.
- Each font weight/style is a separate file. Minimize variants to reduce bundle size.

## manifest.json Alignment

Critical rules for the manifest:

1. **UUID match**: Every action's `UUID` in the manifest must match the `uuid` in `defineAction()`.
2. **CodePath**: Must point to the Rollup output file (e.g., `"CodePath": "bin/plugin.mjs"`).
3. **Nodejs**: Must declare `"Nodejs": { "Version": "20" }`.
4. **Controllers**: Use `["Keypad"]` for key actions, `["Encoder"]` for dial actions.
5. **Encoder block**: Required for encoder actions:
   ```json
   {
     "Controllers": ["Encoder"],
     "Encoder": {
       "layout": "$B1",
       "TriggerDescription": {
         "Rotate": "Description",
         "Push": "Description"
       }
     }
   }
   ```

## Context Provider Tree

Every action root is automatically wrapped:

```
ActionProvider
  DeviceProvider
    CanvasProvider
      EventBusProvider
        StreamDeckProvider
          GlobalSettingsProvider
            SettingsProvider
              PluginWrapper (if set)
                ActionWrapper (if set)
                  <YourComponent />
```

All context values except settings are set once on mount and are immutable.
