import type { ComponentType, ReactNode } from "react";
import type { JsonObject, JsonValue } from "@elgato/utils";
import type { AdapterActionHandle, StreamDeckAdapter } from "@/adapter/types";
import type { ActionManifestInfo, PluginManifestInfo } from "@/manifest-types";

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
// This module contains all shared types for the library's public API.
//
// Manifest generation is code-first: action metadata is defined via
// `info` on each `defineAction()` call and auto-extracted from the
// source code at build time.  The bundler plugin's `manifest` option
// only contains plugin-level info (uuid, name, author, etc.).
//
// UUID validation:
//   Action UUIDs must be prefixed with the plugin UUID (e.g.
//   "com.example.plugin.my-action" starts with "com.example.plugin").
//   This is validated at build time by the bundler plugin.

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
   * Plugin manifest metadata.  Optional — used for runtime
   * documentation.  For manifest generation, provide plugin-level
   * info via the bundler plugin's `manifest` option.
   */
  info?: PluginManifestInfo;

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
  /** Offload Takumi rendering to a worker thread. When not set, auto-detected: enabled only if any action defines a `touchStrip` component. Set explicitly to `true` or `false` to override. Automatically disabled when `takumi` is `"wasm"`. @default auto-detect (true if any action has touchStrip) */
  useWorker?: boolean;
}

export interface Plugin {
  connect(): Promise<void>;
}

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

  /**
   * Action manifest metadata.  This is the **primary source** for
   * manifest.json generation — the bundler plugin auto-extracts
   * `info` from each `defineAction()` call at build time.
   *
   * Set `disabled: true` to exclude this action from the manifest.
   */
  info?: ActionManifestInfo;
}

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

  /**
   * Action manifest metadata.  Carried through from defineAction()
   * for runtime access and manifest generation.
   */
  info?: ActionManifestInfo;
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
