import type { ComponentType, ReactNode } from "react";
import type { JsonObject, JsonValue } from "@elgato/utils";
import type { AdapterActionHandle, StreamDeckAdapter } from "@/adapter/types";

// ── Local Type Aliases ──────────────────────────────────────────────
//
// These replace the SDK imports (Controller, Coordinates, DeviceType,
// Size) with library-owned types.  This decouples the public API from
// @elgato/streamdeck while maintaining the same shapes.
//
// Controller and Coordinates are re-exported as type aliases so that
// existing consumer code that imports them continues to work.
// DeviceType is replaced by plain `number` — the library only uses it
// as a numeric lookup key in the KEY_SIZES table (registry.ts), never
// as named enum members.

/** Controller surface type. */
export type Controller = "Keypad" | "Encoder";

/** Grid coordinates for a key or encoder on a device. */
export interface Coordinates {
  column: number;
  row: number;
}

/** Device grid size (number of key columns and rows). */
export interface Size {
  columns: number;
  rows: number;
}

// ── Central Type Definitions ────────────────────────────────────────
//
// This module contains all shared types plus a type-level safety
// engine that enforces correct action configuration based on the
// plugin manifest.
//
// Type-level safety flow:
//
//   manifest.json (parsed at build time by manifest-codegen.ts)
//     ↓ generates
//   src/streamdeck-env.d.ts (declare module augmentation)
//     ↓ populates
//   ManifestActions interface { "com.example.counter": { controllers: ["Keypad"] } }
//     ↓ consumed by
//   ActionUUID = "com.example.counter" | "com.example.dial" | ...
//     ↓ used in
//   ActionConfigInput<S> = discriminated union per UUID
//     ↓ enforces at defineAction() call site
//   { uuid: "com.example.counter", key: ComponentType }  ← key REQUIRED (Keypad controller)
//   { uuid: "com.example.dial", dial: ComponentType }     ← dial REQUIRED (Encoder controller)
//
// When ManifestActions is empty (no streamdeck-env.d.ts), all types
// fall back to permissive string-based configuration (no enforcement).

// ── Font Configuration ─────────────────────────────────────────────

export interface FontConfig {
  name: string;
  data: ArrayBuffer | Buffer;
  weight: 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
  style: "normal" | "italic";
}

export type WrapperComponent = ComponentType<{ children?: ReactNode }>;

export type TouchStripOpacity = 0 | 0.1 | 0.2 | 0.3 | 0.4 | 0.5 | 0.6 | 0.7 | 0.8 | 0.9 | 1;

export interface TouchStripRange {
  min: number;
  max: number;
}

interface TouchStripItemBase {
  key: string;
  rect: [x: number, y: number, width: number, height: number];
  background?: string;
  enabled?: boolean;
  opacity?: TouchStripOpacity;
  zOrder?: number;
}

interface TouchStripBarBase extends TouchStripItemBase {
  bar_bg_c?: string;
  bar_border_c?: string;
  bar_fill_c?: string;
  border_w?: number;
  range?: TouchStripRange;
  subtype?: 0 | 1 | 2 | 3 | 4;
  value: number;
}

export interface TouchStripBarItem extends TouchStripBarBase {
  type: "bar";
}

export interface TouchStripGBarItem extends TouchStripBarBase {
  type: "gbar";
  bar_h?: number;
}

export interface TouchStripPixmapItem extends TouchStripItemBase {
  type: "pixmap";
  value?: string;
}

export interface TouchStripTextItem extends TouchStripItemBase {
  type: "text";
  alignment?: "center" | "left" | "right";
  color?: string;
  font?: {
    size?: number;
    weight?: number;
  };
  "text-overflow"?: "clip" | "ellipsis" | "fade";
  value?: string;
}

export type TouchStripLayoutItem =
  | TouchStripBarItem
  | TouchStripGBarItem
  | TouchStripPixmapItem
  | TouchStripTextItem;

export interface TouchStripLayout {
  $schema?: string;
  id: string;
  items: TouchStripLayoutItem[];
}

export type EncoderLayout = string | TouchStripLayout;

// ── Takumi Backend ──────────────────────────────────────────────────

/** Takumi renderer backend selection. `"native-binding"` uses the native Rust NAPI addon (`@takumi-rs/core`). `"wasm"` uses the WebAssembly build (`@takumi-rs/wasm`), suitable for WebContainer and browser environments. */
export type TakumiBackend = "native-binding" | "wasm";

// ── Plugin Configuration ────────────────────────────────────────────

export interface PluginConfig {
  /** Stream Deck adapter. Defaults to physicalDevice() (Elgato SDK). */
  adapter?: StreamDeckAdapter;
  fonts: FontConfig[];
  actions: ActionDefinition[];
  wrapper?: WrapperComponent;

  /**
   * Takumi renderer backend.
   *
   * - `"native-binding"` — uses `@takumi-rs/core` (native Rust NAPI addon).
   *   Requires a platform-specific binary (e.g. `@takumi-rs/core-darwin-arm64`).
   * - `"wasm"` — uses `@takumi-rs/wasm` (WebAssembly build).
   *   Requires `@takumi-rs/wasm` to be installed. WOFF fonts are not supported
   *   in this mode — use TTF/OTF only. Worker threads are force-disabled.
   *
   * @default "native-binding"
   */
  takumi?: TakumiBackend;
  imageFormat?: "png" | "webp";
  caching?: boolean;
  devicePixelRatio?: number;
  onActionError?: (uuid: string, actionId: string, error: Error) => void;
  /** Enable the devtools WebSocket server. Browser devtools UI discovers it via port scanning. @default false */
  devtools?: boolean;
  /** Enable performance diagnostics (render counters, duplicate detection, depth warnings). Defaults to `process.env.NODE_ENV !== 'production'`. */
  debug?: boolean;
  /** Maximum image cache size in bytes for key/dial renders. Set to 0 to disable. @default 16777216 (16 MB) */
  imageCacheMaxBytes?: number;
  /** Maximum TouchStrip raw buffer cache size in bytes. Set to 0 to disable. @default 8388608 (8 MB) */
  touchStripCacheMaxBytes?: number;
  /** Offload Takumi rendering to a worker thread. Set to false to disable. Automatically disabled when `takumi` is `"wasm"`. @default true */
  useWorker?: boolean;
}

export interface Plugin {
  connect(): Promise<void>;
}

// ── Manifest Type Registry ──────────────────────────────────────────
// This interface is augmented by the generated `streamdeck-env.d.ts`
// file via `declare module "@fcannizzaro/streamdeck-react"`.
//
// When populated, it enables:
//   1. Type-safe action UUIDs (typos caught at compile time)
//   2. Controller-based property requirements in defineAction()
//
// The `[keyof ManifestActions] extends [never]` idiom used throughout
// this file tests whether the interface has any members.  When empty
// (no augmentation), it evaluates to `true` and types fall back to
// permissive mode (plain string UUIDs, all props optional).

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ManifestActions {}

/** Action UUID — a union of manifest UUIDs when available, plain `string` otherwise. */
export type ActionUUID = [keyof ManifestActions] extends [never]
  ? string
  : Extract<keyof ManifestActions, string>;

// ── Controller-aware Helpers ────────────────────────────────────────
// These conditional types inspect the controllers tuple from
// ManifestActions to determine which surface props (key/dial/touchStrip)
// should be required vs optional.
//
// HasController<UUID, C>:
//   Extracts the `controllers` tuple for a UUID, then checks if C
//   is a member via `C extends Item`.  Returns `true` or `false`
//   at the type level.
//
// KeySurface<UUID>:
//   If the action has "Keypad" controller → { key: ComponentType }  (required)
//   Otherwise → { key?: ComponentType }  (optional)
//
// EncoderSurface<UUID>:
//   If the action has "Encoder" controller → at least one of dial or
//   touchStrip must be provided (union of two shapes).
//   Otherwise → both optional.

type HasController<UUID extends string, C extends string> = UUID extends keyof ManifestActions
  ? ManifestActions[UUID] extends { controllers: readonly (infer Item)[] }
    ? C extends Item
      ? true
      : false
    : false
  : false;

type KeySurface<UUID extends string> =
  HasController<UUID, "Keypad"> extends true ? { key: ComponentType } : { key?: ComponentType };

type EncoderSurface<UUID extends string> =
  HasController<UUID, "Encoder"> extends true
    ?
        | { dial: ComponentType; touchStrip?: ComponentType }
        | { dial?: ComponentType; touchStrip: ComponentType }
    : { dial?: ComponentType; touchStrip?: ComponentType };

// ── Action Definition ───────────────────────────────────────────────

export interface ActionConfig<S extends JsonObject = JsonObject> {
  uuid: string;
  key?: ComponentType;
  dial?: ComponentType;
  /** Full-strip TouchStrip component. When set, replaces per-encoder `dial` display with a single shared React tree that spans the entire touch strip. */
  touchStrip?: ComponentType;
  /** Encoder feedback layout. Defaults to a full-width `pixmap` canvas layout. Custom layouts should include a `pixmap` item keyed as `canvas`. */
  dialLayout?: EncoderLayout;
  wrapper?: WrapperComponent;
  defaultSettings?: Partial<S>;
}

/** Resolved action config shape. When `ManifestActions` is populated (via `streamdeck-env.d.ts`), this becomes a mapped type that iterates over every UUID in the manifest and produces a discriminated union. Each member intersects `KeySurface<UUID>` and `EncoderSurface<UUID>` to enforce controller-specific requirements. When `ManifestActions` is empty, it falls back to the permissive `ActionConfig<S>`. */
export type ActionConfigInput<S extends JsonObject = JsonObject> = [keyof ManifestActions] extends [
  never,
]
  ? ActionConfig<S>
  : {
      [UUID in ActionUUID]: {
        uuid: UUID;
        /** Encoder feedback layout. Defaults to a full-width `pixmap` canvas layout. Custom layouts should include a `pixmap` item keyed as `canvas`. */
        dialLayout?: EncoderLayout;
        wrapper?: WrapperComponent;
        defaultSettings?: Partial<S>;
      } & KeySurface<UUID> &
        EncoderSurface<UUID>;
    }[ActionUUID];

export interface ActionDefinition<S extends JsonObject = JsonObject> {
  uuid: string;
  key?: ComponentType;
  dial?: ComponentType;
  /** Full-strip TouchStrip component. When set, replaces per-encoder `dial` display with a single shared React tree that spans the entire touch strip. */
  touchStrip?: ComponentType;
  /** Encoder feedback layout. Defaults to a full-width `pixmap` canvas layout. Custom layouts should include a `pixmap` item keyed as `canvas`. */
  dialLayout?: EncoderLayout;
  wrapper?: WrapperComponent;
  defaultSettings: Partial<S>;
}

// ── Device Info ─────────────────────────────────────────────────────

export interface DeviceInfo {
  id: string;
  /** Numeric device type matching Elgato DeviceType enum values (e.g. 7 = StreamDeckPlus). */
  type: number;
  size: Size;
  name: string;
}

// ── Action Info ─────────────────────────────────────────────────────

export interface ActionInfo {
  id: string;
  uuid: string;
  controller: Controller;
  coordinates?: Coordinates;
  isInMultiAction: boolean;
}

// ── Canvas Info ─────────────────────────────────────────────────────

export interface CanvasInfo {
  width: number;
  height: number;
  type: "key" | "dial" | "touch";
}

// ── StreamDeck Access ───────────────────────────────────────────────
//
// Provided via React context to hooks (useStreamDeck, useOpenUrl, etc.).
// Previously held raw SDK types; now uses adapter interfaces so that
// alternative backends (web simulator, test harness) work transparently.

export interface StreamDeckAccess {
  action: AdapterActionHandle;
  adapter: StreamDeckAdapter;
}

// ── Event Payloads ──────────────────────────────────────────────────

export interface KeyDownPayload {
  settings: JsonObject;
  isInMultiAction: boolean;
  state?: number;
  userDesiredState?: number;
}

export interface KeyUpPayload {
  settings: JsonObject;
  isInMultiAction: boolean;
  state?: number;
  userDesiredState?: number;
}

export interface DialRotatePayload {
  ticks: number;
  pressed: boolean;
  settings: JsonObject;
}

export interface DialPressPayload {
  settings: JsonObject;
  controller: "Encoder";
}

export interface TouchTapPayload {
  tapPos: [x: number, y: number];
  hold: boolean;
  settings: JsonObject;
}

export interface WillAppearPayload {
  settings: JsonObject;
  controller: Controller;
  isInMultiAction: boolean;
}

export interface DialHints {
  rotate?: string;
  press?: string;
  touch?: string;
  longTouch?: string;
}

// ── Touch Bar Info ──────────────────────────────────────────────────

export interface TouchStripInfo {
  /** Full render width in pixels (e.g., 800 for 4 encoders). */
  width: number;
  /** Strip height in pixels (always 100). */
  height: number;
  /** Sorted list of active encoder columns, e.g., [0, 1, 3]. */
  columns: number[];
  /** Width of each encoder segment in pixels (always 200). */
  segmentWidth: number;
}

// ── Touch Bar Event Payloads ────────────────────────────────────────

export interface TouchStripTapPayload {
  /** Absolute tap position across the full strip width. */
  tapPos: [x: number, y: number];
  hold: boolean;
  /** The encoder column that was touched. */
  column: number;
}

export interface TouchStripDialRotatePayload {
  column: number;
  ticks: number;
  pressed: boolean;
}

export interface TouchStripDialPressPayload {
  column: number;
}

// ── Event Bus Types ─────────────────────────────────────────────────

export interface EventMap {
  keyDown: KeyDownPayload;
  keyUp: KeyUpPayload;
  dialRotate: DialRotatePayload;
  dialDown: DialPressPayload;
  dialUp: DialPressPayload;
  touchTap: TouchTapPayload;
  willAppear: WillAppearPayload;
  willDisappear: void;
  settingsChanged: JsonObject;
  sendToPlugin: JsonValue;
  propertyInspectorDidAppear: void;
  propertyInspectorDidDisappear: void;
  titleParametersDidChange: {
    title: string;
    settings: JsonObject;
  };
  touchStripTap: TouchStripTapPayload;
  touchStripDialRotate: TouchStripDialRotatePayload;
  touchStripDialDown: TouchStripDialPressPayload;
  touchStripDialUp: TouchStripDialPressPayload;
}
