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
  renderDebounceMs?: number;
  imageFormat?: "png" | "webp";
  caching?: boolean;
  devicePixelRatio?: number;
  onActionError?: (uuid: string, actionId: string, error: Error) => void;
}

export interface Plugin {
  connect(): Promise<void>;
}

// ── Action Definition ───────────────────────────────────────────────

export interface ActionConfig<S extends JsonObject = JsonObject> {
  uuid: string;
  key?: ComponentType;
  dial?: ComponentType;
  touch?: ComponentType;
  /** Full-strip touchbar component. When set, replaces per-encoder `dial` display with a single shared React tree that spans the entire touch strip. */
  touchBar?: ComponentType;
  /** Target frame rate for the touchbar animation loop and render pipeline. Controls both `useTick` cadence (via `useTouchBar().fps`) and the render debounce. @default 60 */
  touchBarFPS?: number;
  /** Encoder feedback layout. Defaults to a full-width `pixmap` canvas layout. Custom layouts should include a `pixmap` item keyed as `canvas`. */
  dialLayout?: EncoderLayout;
  wrapper?: WrapperComponent;
  defaultSettings?: Partial<S>;
}

export interface ActionDefinition<S extends JsonObject = JsonObject> {
  uuid: string;
  key?: ComponentType;
  dial?: ComponentType;
  touch?: ComponentType;
  /** Full-strip touchbar component. When set, replaces per-encoder `dial` display with a single shared React tree that spans the entire touch strip. */
  touchBar?: ComponentType;
  /** Target frame rate for the touchbar animation loop and render pipeline. @default 60 */
  touchBarFPS?: number;
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

export interface TouchBarInfo {
  /** Full render width in pixels (e.g., 800 for 4 encoders). */
  width: number;
  /** Strip height in pixels (always 100). */
  height: number;
  /** Sorted list of active encoder columns, e.g., [0, 1, 3]. */
  columns: number[];
  /** Width of each encoder segment in pixels (always 200). */
  segmentWidth: number;
  /** Target frame rate for the animation loop. Pass to `useTick` for matched cadence. */
  fps: number;
}

// ── Touch Bar Event Payloads ────────────────────────────────────────

export interface TouchBarTapPayload {
  /** Absolute tap position across the full strip width. */
  tapPos: [x: number, y: number];
  hold: boolean;
  /** The encoder column that was touched. */
  column: number;
}

export interface TouchBarDialRotatePayload {
  column: number;
  ticks: number;
  pressed: boolean;
}

export interface TouchBarDialPressPayload {
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
  touchBarTap: TouchBarTapPayload;
  touchBarDialRotate: TouchBarDialRotatePayload;
  touchBarDialDown: TouchBarDialPressPayload;
  touchBarDialUp: TouchBarDialPressPayload;
}
