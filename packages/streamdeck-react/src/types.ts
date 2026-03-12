import type { ComponentType, ReactNode } from "react";
import type {
  Action,
  Controller,
  Coordinates,
  DeviceType,
  DialAction,
  KeyAction,
  Size,
} from "@elgato/streamdeck";
import type { JsonObject, JsonValue } from "@elgato/utils";

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

// ── Plugin Configuration ────────────────────────────────────────────

export interface PluginConfig {
  fonts: FontConfig[];
  actions: ActionDefinition[];
  wrapper?: WrapperComponent;

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
  /** Offload Takumi rendering to a worker thread. Set to false to disable. @default true */
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
  type: DeviceType;
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

export interface StreamDeckAccess {
  action: Action | DialAction | KeyAction;
  sdk: typeof import("@elgato/streamdeck").default;
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
