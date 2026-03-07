# API Surface

Complete public API exported from `@fcannizzaro/streamdeck-react`.

## Plugin Setup

| Export | Type | Description |
|--------|------|-------------|
| `createPlugin(config)` | Function | Creates and configures the plugin runtime. Returns `{ connect() }`. |
| `defineAction(config)` | Function | Maps a manifest UUID to React components for key and dial rendering, plus touch-aware action definitions. |

## Event Hooks

| Export | Signature | Description |
|--------|-----------|-------------|
| `useKeyDown` | `(cb: (payload: KeyDownPayload) => void) => void` | Fires when a key is pressed down. |
| `useKeyUp` | `(cb: (payload: KeyUpPayload) => void) => void` | Fires when a key is released. |
| `useDialRotate` | `(cb: (payload: DialRotatePayload) => void) => void` | Fires when a dial/encoder is rotated. |
| `useDialDown` | `(cb: (payload: DialPressPayload) => void) => void` | Fires when a dial is pressed. |
| `useDialUp` | `(cb: (payload: DialPressPayload) => void) => void` | Fires when a dial is released. |
| `useTouchTap` | `(cb: (payload: TouchTapPayload) => void) => void` | Fires when the touch strip is tapped. |
| `useDialHint` | `(hints: DialHints) => void` | Sets encoder trigger descriptions on Stream Deck+. |

## Settings Hooks

| Export | Signature | Description |
|--------|-----------|-------------|
| `useSettings` | `<S extends JsonObject>() => [S, (partial: Partial<S>) => void]` | Bidirectional per-action settings sync. Shallow-merge semantics. |
| `useGlobalSettings` | `<G extends JsonObject>() => [G, (partial: Partial<G>) => void]` | Plugin-wide global settings sync. Same merge semantics. |

## Context Hooks

| Export | Signature | Description |
|--------|-----------|-------------|
| `useDevice` | `() => DeviceInfo` | Device ID, type, size, and name. Set once on mount. |
| `useAction` | `() => ActionInfo` | Action context ID, UUID, controller, coordinates. Set once on mount. |
| `useCanvas` | `() => CanvasInfo` | Render target dimensions (`width`, `height`, `type`). Set once on mount. |
| `useStreamDeck` | `() => StreamDeckAccess` | Raw SDK escape hatch: `{ action, sdk }`. |

## Lifecycle Hooks

| Export | Signature | Description |
|--------|-----------|-------------|
| `useWillAppear` | `(cb: (payload: WillAppearPayload) => void) => void` | Fires once when the action appears and the root is mounted. |
| `useWillDisappear` | `(cb: () => void) => void` | Fires when the action is about to disappear (root unmounting). |

## Utility Hooks

| Export | Signature | Description |
|--------|-----------|-------------|
| `useInterval` | `(cb: () => void, delayMs: number \| null) => IntervalControls` | Auto-cleaning interval. Pass `null` to pause. Returns `{ reset }`. |
| `useTimeout` | `(cb: () => void, delayMs: number \| null) => TimeoutControls` | Auto-cleaning timeout. Pass `null` to cancel. Returns `{ cancel, reset }`. |
| `usePrevious` | `<T>(value: T) => T \| undefined` | Returns the value from the previous render. |
| `useTick` | `(cb: (deltaMs: number) => void, fpsOrActive?: number \| boolean) => void` | Animation frame loop. Default 60fps. Pass `false` to pause. |
| `useAnimationFrame` | `(cb: (deltaMs: number) => void, active?: boolean) => void` | **Deprecated**. Use `useTick` instead. |

## SDK Hooks

| Export | Signature | Description |
|--------|-----------|-------------|
| `useOpenUrl` | `() => (url: string) => Promise<void>` | Opens a URL in the user's default browser. |
| `useSwitchProfile` | `() => (profile: string, deviceId?: string) => Promise<void>` | Switches Stream Deck profile. |
| `useSendToPI` | `() => (payload: JsonValue) => Promise<void>` | Sends a message to the Property Inspector. |
| `usePropertyInspector` | `<T extends JsonValue>(cb: (payload: T) => void) => void` | Receives messages from the Property Inspector. |
| `useShowAlert` | `() => () => Promise<void>` | Triggers the alert overlay animation. |
| `useShowOk` | `() => () => Promise<void>` | Triggers the OK checkmark overlay. Key actions only. |
| `useTitle` | `() => (title: string) => Promise<void>` | Sets the native title overlay. Key actions only. |

## Components

| Export | Element | Description |
|--------|---------|-------------|
| `Box` | `div` | Flex container with shorthand layout props. |
| `Text` | `span` | Text with shorthand style props. |
| `Image` | `img` | Image with required dimensions and optional `fit`. |
| `Icon` | `svg` | Single SVG path icon. |
| `ProgressBar` | `div` | Horizontal progress bar. |
| `CircularGauge` | `svg` | Ring/arc gauge via SVG. |
| `ErrorBoundary` | -- | React error boundary with fallback. |

## Tailwind Utility

| Export | Signature | Description |
|--------|-----------|-------------|
| `tw` | `(...args: Array<string \| false \| null \| undefined \| 0>) => string` | Class string concatenation (like `clsx`). |

## Rollup Helpers (from `@fcannizzaro/streamdeck-react/rollup`)

| Export | Description |
|--------|-------------|
| `nativeAddon(options?)` | Rollup plugin that copies the selected `@takumi-rs/core` native `.node` binaries into the output directory. |

### Rollup Types

| Export | Description |
|--------|-------------|
| `NativeAddonOptions` | Rollup helper options with a `targets` array. |
| `NativeAddonTarget` | One native copy target: `{ platform, arch }`. |
| `NativeAddonPlatform` | `'darwin' \| 'linux' \| 'win32'`. |
| `NativeAddonArch` | `'arm64' \| 'x64'`. |
| `NativeAddonLibc` | `'gnu' \| 'musl'`. |

## Types

| Export | Kind | Description |
|--------|------|-------------|
| `PluginConfig` | Interface | Configuration for `createPlugin()`. |
| `FontConfig` | Interface | Font file descriptor: `name`, `data`, `weight`, `style`. |
| `ActionConfig` | Interface | Configuration for `defineAction()`. |
| `ActionDefinition` | Interface | Resolved action definition (output of `defineAction`). |
| `WrapperComponent` | Type | `ComponentType<{ children?: ReactNode }>`. |
| `DeviceInfo` | Interface | Device metadata: `id`, `type`, `size`, `name`. |
| `ActionInfo` | Interface | Action instance metadata: `id`, `uuid`, `controller`, `coordinates`, `isInMultiAction`. |
| `CanvasInfo` | Interface | Render target: `width`, `height`, `type` (`'key' \| 'dial' \| 'touch'`). |
| `KeyDownPayload` | Interface | `{ settings, isInMultiAction, state?, userDesiredState? }`. |
| `KeyUpPayload` | Interface | Same shape as `KeyDownPayload`. |
| `DialRotatePayload` | Interface | `{ ticks, pressed, settings }`. |
| `DialPressPayload` | Interface | `{ settings, controller: 'Encoder' }`. |
| `TouchTapPayload` | Interface | `{ tapPos: [x, y], hold, settings }`. |
| `DialHints` | Interface | `{ rotate?, press?, touch?, longTouch? }`. |
| `StreamDeckAccess` | Interface | `{ action: Action \| DialAction \| KeyAction, sdk }`. |

## Component Props Types

| Export | Description |
|--------|-------------|
| `BoxProps` | Props for `Box` component. |
| `TextProps` | Props for `Text` component. |
| `ImageProps` | Props for `Image` component. |
| `IconProps` | Props for `Icon` component. |
| `ProgressBarProps` | Props for `ProgressBar` component. |
| `CircularGaugeProps` | Props for `CircularGauge` component. |
| `ErrorBoundaryProps` | Props for `ErrorBoundary` component. |
