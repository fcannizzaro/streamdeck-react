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
  renderDebounceMs?: number;   // Default: 16 (~60fps ceiling)
  imageFormat?: 'png' | 'webp'; // Default: 'png'
  caching?: boolean;            // Default: true
  onActionError?: (uuid: string, actionId: string, error: Error) => void;
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `fonts` | Yes | At least one font file. See FontConfig below. |
| `actions` | Yes | Array of action definitions from `defineAction()`. |
| `wrapper` | No | Component that wraps ALL action roots. Use for global providers. |
| `renderDebounceMs` | No | Coalesces renders. Increase for dial-heavy UIs. |
| `imageFormat` | No | Output format. PNG is default and most compatible. |
| `caching` | No | FNV-1a hash caching to skip duplicate `setImage()` calls. |
| `onActionError` | No | Called when a component throws in any action root. |

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

Must be called after `createPlugin()` and must be the last call in the entry file. It:

1. Creates a `SingletonAction` subclass for each action definition.
2. Registers them with `streamDeck.actions.registerAction()`.
3. Calls `streamDeck.connect()`.
4. Loads initial global settings.

## defineAction(config)

Maps a manifest UUID to React components.

```ts
import { defineAction } from '@fcannizzaro/streamdeck-react';

export const myAction = defineAction({
  uuid: 'com.example.plugin.my-action',
  key: MyKeyComponent,
});
```

### ActionConfig

```ts
interface ActionConfig<S extends JsonObject = JsonObject> {
  uuid: string;
  key?: ComponentType;
  dial?: ComponentType;
  touch?: ComponentType;
  dialLayout?: EncoderLayout;
  wrapper?: WrapperComponent;
  defaultSettings?: Partial<S>;
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `uuid` | Yes | Must exactly match the `UUID` in `manifest.json`. |
| `key` | No | Component for key (Keypad controller). |
| `dial` | No | Component for encoder display (Stream Deck+). Falls back to `key` if not provided. |
| `touch` | No | Reserved in the current action shape; prefer `useTouchTap()` for touch interaction guidance in user projects. |
| `dialLayout` | No | Encoder feedback layout. Defaults to a full-width canvas `pixmap` layout keyed as `canvas`. |
| `wrapper` | No | Component that wraps this action's root (nested inside plugin wrapper). |
| `defaultSettings` | No | Default settings shallow-merged with stored settings. |

### Typed Settings

Pass a type parameter for type-safe settings:

```tsx
type VolumeSettings = { volume: number; muted: boolean };

export const volumeAction = defineAction<VolumeSettings>({
  uuid: 'com.example.plugin.volume',
  key: VolumeKey,
  dial: VolumeDial,
  dialLayout: '$A1',
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
  style: 'normal' | 'italic';
}
```

### Loading Fonts

```ts
import { readFile } from 'node:fs/promises';

const fonts: FontConfig[] = [
  {
    name: 'Inter',
    data: await readFile(new URL('../fonts/Inter-Regular.ttf', import.meta.url)),
    weight: 400,
    style: 'normal',
  },
  {
    name: 'Inter',
    data: await readFile(new URL('../fonts/Inter-Bold.ttf', import.meta.url)),
    weight: 700,
    style: 'normal',
  },
];
```

### Font Rules

- At least one font is required in `createPlugin()`.
- Supported formats: `.ttf`, `.otf`, `.woff`.
- **WOFF2 is NOT supported.**
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
SettingsProvider
  GlobalSettingsProvider
    ActionProvider
      DeviceProvider
        CanvasProvider
          EventBusProvider
            StreamDeckProvider
              PluginWrapper (if set)
                ActionWrapper (if set)
                  RootWrapper (sized to canvas)
                    <YourComponent />
```

All context values except settings are set once on mount and are immutable.
