# Hooks

Complete reference for all hooks exported by `@fcannizzaro/streamdeck-react`.

## Event Hooks

All event hooks subscribe to the root's EventBus via `useEffect` and use a stable callback ref to avoid stale closures.

### useKeyDown

Fires when a key is pressed down.

```ts
function useKeyDown(callback: (payload: KeyDownPayload) => void): void;

interface KeyDownPayload {
  settings: JsonObject;
  isInMultiAction: boolean;
  state?: number;
  userDesiredState?: number;
}
```

### useKeyUp

Fires when a key is released.

```ts
function useKeyUp(callback: (payload: KeyUpPayload) => void): void;

interface KeyUpPayload {
  settings: JsonObject;
  isInMultiAction: boolean;
  state?: number;
  userDesiredState?: number;
}
```

### useDialRotate

Fires when a dial/encoder is rotated.

```ts
function useDialRotate(callback: (payload: DialRotatePayload) => void): void;

interface DialRotatePayload {
  ticks: number;      // Positive = clockwise, negative = counter-clockwise
  pressed: boolean;   // Whether the dial is pressed while rotating
  settings: JsonObject;
}
```

### useDialDown / useDialUp

Fire when a dial is pressed / released.

```ts
function useDialDown(callback: (payload: DialPressPayload) => void): void;
function useDialUp(callback: (payload: DialPressPayload) => void): void;

interface DialPressPayload {
  settings: JsonObject;
  controller: 'Encoder';
}
```

### useTouchTap

Fires when the touch strip is tapped.

```ts
function useTouchTap(callback: (payload: TouchTapPayload) => void): void;

interface TouchTapPayload {
  tapPos: [x: number, y: number];  // Tap coordinates
  hold: boolean;                    // Whether it was a long press
  settings: JsonObject;
}
```

### useDialHint

Sets the encoder trigger descriptions shown on Stream Deck+. Updates automatically when hint values change. Calls `action.setTriggerDescription()` under the hood.

```ts
function useDialHint(hints: DialHints): void;

interface DialHints {
  rotate?: string;
  press?: string;
  touch?: string;
  longTouch?: string;
}
```

Example:

```tsx
function VolumeDial() {
  const [muted, setMuted] = useState(false);

  useDialHint({
    rotate: 'Adjust volume',
    press: muted ? 'Unmute' : 'Mute',
  });

  // ...
}
```

## Settings Hooks

### useSettings

Returns `[settings, setSettings]` with shallow-merge semantics. Bidirectional sync with the Stream Deck SDK.

```ts
function useSettings<S extends JsonObject = JsonObject>(): [S, (partial: Partial<S>) => void];
```

**Merge semantics**: `setSettings` does `{ ...current, ...partial }` -- always merges, never replaces. This matches the SDK's `setSettings` behavior.

**Sync flow**:
1. **React to SDK**: calling `setSettings({ count: 5 })` updates React state (triggers re-render) AND calls `action.setSettings()` to persist.
2. **SDK to React**: Property Inspector settings changes (`onDidReceiveSettings`) update internal state and re-render components using `useSettings()`.
3. **Conflict resolution**: the SDK is source of truth. Last write wins.

### useGlobalSettings

Same pattern as `useSettings`, but for plugin-wide global settings shared across all action instances.

```ts
function useGlobalSettings<G extends JsonObject = JsonObject>(): [G, (partial: Partial<G>) => void];
```

## Lifecycle Hooks

### useWillAppear

Fires once when the action instance appears and the React root is mounted. Use for initialization.

```ts
function useWillAppear(callback: (payload: WillAppearPayload) => void): void;

interface WillAppearPayload {
  settings: JsonObject;
  controller: 'Keypad' | 'Encoder';
  isInMultiAction: boolean;
}
```

### useWillDisappear

Fires when the action is about to disappear (React root is being unmounted).

```ts
function useWillDisappear(callback: () => void): void;
```

Note: Because `onWillDisappear` unmounts the entire React root, `useEffect` cleanup functions already handle teardown. `useWillDisappear` is a convenience for explicit opt-in.

## Context Hooks

### useDevice

Returns information about the Stream Deck device. Set once on mount (immutable).

```ts
function useDevice(): DeviceInfo;

interface DeviceInfo {
  id: string;
  type: DeviceType;  // e.g. 0 (StreamDeck), 2 (StreamDeckXL), 7 (StreamDeckPlus)
  size: { columns: number; rows: number };
  name: string;
}
```

### useAction

Returns metadata about the current action instance. Set once on mount (immutable).

```ts
function useAction(): ActionInfo;

interface ActionInfo {
  id: string;             // Unique context ID for this placed instance
  uuid: string;           // Action UUID (e.g. 'com.example.plugin.counter')
  controller: 'Keypad' | 'Encoder';
  coordinates?: { row: number; column: number };
  isInMultiAction: boolean;
}
```

### useCanvas

Returns render target dimensions. Set once on mount (immutable).

```ts
function useCanvas(): CanvasInfo;

interface CanvasInfo {
  width: number;    // Pixel width of the render target
  height: number;   // Pixel height of the render target
  type: 'key' | 'dial' | 'touch';
}
```

### useStreamDeck

Escape hatch: direct access to the underlying SDK objects. Use sparingly.

```ts
function useStreamDeck(): StreamDeckAccess;

interface StreamDeckAccess {
  action: Action | DialAction | KeyAction;
  sdk: typeof streamDeck;
}
```

## SDK Hooks

### useOpenUrl

Opens a URL in the user's default browser.

```ts
function useOpenUrl(): (url: string) => Promise<void>;
```

### useSwitchProfile

Switches to a different Stream Deck profile. If `deviceId` is omitted, the current device is used.

```ts
function useSwitchProfile(): (profile: string, deviceId?: string) => Promise<void>;
```

### useSendToPI

Sends a message to the Property Inspector.

```ts
function useSendToPI(): (payload: JsonValue) => Promise<void>;
```

### usePropertyInspector

Receives messages sent from the Property Inspector via `sendToPlugin`.

```ts
function usePropertyInspector<T extends JsonValue = JsonValue>(
  callback: (payload: T) => void,
): void;
```

### useShowAlert

Triggers the Stream Deck's built-in alert overlay animation on the key.

```ts
function useShowAlert(): () => Promise<void>;
```

### useShowOk

Triggers the OK checkmark overlay. Key actions only.

```ts
function useShowOk(): () => Promise<void>;
```

### useTitle

Sets the native Stream Deck title overlay (separate from the rendered image). Key actions only.

```ts
function useTitle(): (title: string) => Promise<void>;
```

## Utility Hooks

### useInterval

Auto-cleaning interval. Pass `null` to pause.

```ts
function useInterval(callback: () => void, delayMs: number | null): IntervalControls;

interface IntervalControls {
  reset: () => void;  // Restart the interval from zero
}
```

### useTimeout

Auto-cleaning timeout. Pass `null` to cancel.

```ts
function useTimeout(callback: () => void, delayMs: number | null): TimeoutControls;

interface TimeoutControls {
  cancel: () => void;
  reset: () => void;
}
```

### usePrevious

Returns the value from the previous render. Undefined on first render.

```ts
function usePrevious<T>(value: T): T | undefined;
```

### useTick

Animation frame loop driven by timers. Receives elapsed milliseconds since the last tick.

```ts
function useTick(
  callback: (deltaMs: number) => void,
  fpsOrActive?: number | boolean,  // Default: 60. Pass false to pause.
): void;
```

Actual frame rate is capped by `renderDebounceMs` (default 16ms). In practice, real throughput is roughly 10-30fps depending on component complexity.

### useAnimationFrame (Deprecated)

Legacy wrapper that calls `useTick` with 60fps when active. Use `useTick` instead.

```ts
function useAnimationFrame(callback: (deltaMs: number) => void, active?: boolean): void;
```
