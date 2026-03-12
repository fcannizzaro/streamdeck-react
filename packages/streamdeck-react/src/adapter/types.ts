// ── Adapter Type Definitions ────────────────────────────────────────
//
// Adapter-level interfaces for abstracting the Stream Deck SDK.
// These match the subset of SDK types actually used by the library,
// enabling alternative backends (web simulator, test harness, etc.)
// without depending on @elgato/streamdeck.
//
// Design rationale:
//
//   The library previously imported concrete types (Action, DialAction,
//   KeyAction, DeviceType, etc.) from @elgato/streamdeck throughout
//   the codebase.  This made the SDK a hard dependency even for use
//   cases that don't involve physical hardware (web previews, testing).
//
//   The adapter layer defines its own interfaces that mirror the SDK
//   surface the library actually uses.  The physical device adapter
//   (physical-device.ts) bridges these interfaces to the real SDK,
//   keeping @elgato/streamdeck as an optional peer dependency.
//
// Event flow:
//
//   Adapter backend (SDK, WebSocket, etc.)
//     ↓ fires event
//   AdapterActionCallbacks.onKeyDown(actionId, payload)
//     ↓ library routes to
//   registry.dispatch(actionId, "keyDown", payload)
//     ↓
//   EventBus → useKeyDown() hook in user component

import type { JsonObject, JsonValue } from "@elgato/utils";

// ── Primitive Types ─────────────────────────────────────────────────

/** Controller surface type. Matches SDK Controller values exactly. */
export type AdapterController = "Keypad" | "Encoder";

/** Grid coordinates for a key or encoder on a device. */
export interface AdapterCoordinates {
  readonly column: number;
  readonly row: number;
}

/** Device grid size (number of key columns and rows). */
export interface AdapterSize {
  readonly columns: number;
  readonly rows: number;
}

// ── Dial Trigger Description ────────────────────────────────────────

/** Hint labels for dial/encoder trigger zones shown on the Stream Deck LCD. */
export interface AdapterTriggerDescription {
  rotate?: string;
  push?: string;
  touch?: string;
  longTouch?: string;
}

// ── Action Handle ───────────────────────────────────────────────────
//
// Per-action handle that the adapter provides for each willAppear event.
// Unifies KeyAction, DialAction, and Action behind a single interface.
//
// Methods that are not applicable for a given surface (e.g. setImage
// on a dial) should no-op and resolve immediately.  The physical adapter
// wraps the SDK action and delegates with runtime guards; alternative
// adapters implement their own behavior.
//
// Why a single flat interface instead of discriminated Key/Dial variants:
//   The library routes to the correct method based on canvas.type
//   (determined at root creation time), not based on the action handle's
//   runtime type.  A flat interface eliminates repetitive `"setImage" in
//   action` type guards scattered across roots and hooks.

export interface AdapterActionHandle {
  readonly id: string;
  readonly device: AdapterActionDevice;
  readonly controllerType: AdapterController;
  readonly coordinates?: AdapterCoordinates;

  // ── Key operations ──────────────────────────────────────────────
  /** Push a rendered data URI to the key display. No-op on encoder surfaces. */
  setImage(dataUri: string): Promise<void>;
  /** Set the key title overlay. No-op on encoder surfaces. */
  setTitle(title: string): Promise<void>;
  /** Flash the OK checkmark on the key. No-op on encoder surfaces. */
  showOk(): Promise<void>;

  // ── Shared operations ───────────────────────────────────────────
  /** Flash the alert triangle on the action. */
  showAlert(): Promise<void>;
  /** Persist action settings to the Stream Deck. */
  setSettings(settings: JsonObject): Promise<void>;

  // ── Encoder operations ──────────────────────────────────────────
  /** Push dial/touchstrip feedback payload. No-op on key surfaces. */
  setFeedback(payload: Record<string, unknown>): Promise<void>;
  /** Set the encoder feedback layout (JSON or layout ID). No-op on key surfaces. */
  setFeedbackLayout(layout: string | Record<string, unknown>): Promise<void>;
  /** Set dial hint text (rotate, push, touch labels). No-op on key surfaces. */
  setTriggerDescription(hints: AdapterTriggerDescription): Promise<void>;
}

/** Device info as seen from an action event. */
export interface AdapterActionDevice {
  readonly id: string;
  /**
   * Numeric device type matching Elgato DeviceType enum values.
   * Using `number` instead of the SDK's enum avoids coupling to specific
   * device models while remaining compatible with the KEY_SIZES lookup
   * table in registry.ts.
   */
  readonly type: number;
  readonly size: AdapterSize;
  readonly name: string;
}

// ── Adapter Events ──────────────────────────────────────────────────

/** Event payload provided to onWillAppear callbacks. */
export interface AdapterWillAppearEvent {
  action: AdapterActionHandle;
  payload: {
    settings: JsonObject;
    controller: AdapterController;
    isInMultiAction: boolean;
  };
}

// ── Adapter Event Payloads ──────────────────────────────────────────
//
// Minimal payloads that the adapter must provide.  These mirror the
// EventMap payloads in types.ts but are defined separately to avoid
// circular imports between adapter/ and the rest of the library.
// The library maps these 1:1 onto the internal EventMap when
// dispatching to React roots.

export interface AdapterKeyDownPayload {
  settings: JsonObject;
  isInMultiAction: boolean;
  state?: number;
  userDesiredState?: number;
}

export interface AdapterKeyUpPayload {
  settings: JsonObject;
  isInMultiAction: boolean;
  state?: number;
  userDesiredState?: number;
}

export interface AdapterDialRotatePayload {
  ticks: number;
  pressed: boolean;
  settings: JsonObject;
}

export interface AdapterDialPressPayload {
  settings: JsonObject;
  controller: "Encoder";
}

export interface AdapterTouchTapPayload {
  tapPos: [x: number, y: number];
  hold: boolean;
  settings: JsonObject;
}

// ── Action Callbacks ────────────────────────────────────────────────
//
// The library provides these callbacks when registering an action.
// The adapter invokes them when the corresponding SDK event fires.
//
// Each callback receives the actionId as the first argument so the
// library can route events to the correct React root without needing
// to store the action handle (which is only available at willAppear).

export interface AdapterActionCallbacks {
  onWillAppear(ev: AdapterWillAppearEvent): void;
  onWillDisappear(actionId: string): void;
  onKeyDown(actionId: string, payload: AdapterKeyDownPayload): void;
  onKeyUp(actionId: string, payload: AdapterKeyUpPayload): void;
  onDialRotate(actionId: string, payload: AdapterDialRotatePayload): void;
  onDialDown(actionId: string, payload: AdapterDialPressPayload): void;
  onDialUp(actionId: string, payload: AdapterDialPressPayload): void;
  onTouchTap(actionId: string, payload: AdapterTouchTapPayload): void;
  onDidReceiveSettings(actionId: string, settings: JsonObject): void;
  onSendToPlugin(actionId: string, payload: JsonValue): void;
  onPropertyInspectorDidAppear(actionId: string): void;
  onPropertyInspectorDidDisappear(actionId: string): void;
  onTitleParametersDidChange(
    actionId: string,
    payload: { title: string; settings: JsonObject },
  ): void;
}

// ── Main Adapter Interface ──────────────────────────────────────────
//
// The contract between the library and any Stream Deck backend.
// physicalDevice() implements this for the Elgato SDK.
// Alternative adapters (web simulator, test harness) implement their own.
//
//   createPlugin({ adapter: physicalDevice() })   ← real hardware
//   createPlugin({ adapter: webSimulator() })     ← browser preview
//   createPlugin({ adapter: testAdapter() })      ← unit tests

export interface StreamDeckAdapter {
  /** Plugin UUID, used for devtools identification. */
  readonly pluginUUID: string;

  // ── Connection lifecycle ──────────────────────────────────────
  /** Initialize the adapter and connect to the backend. */
  connect(): Promise<void>;

  // ── Global settings ───────────────────────────────────────────
  /** Retrieve plugin-wide global settings. */
  getGlobalSettings<T extends JsonObject = JsonObject>(): Promise<T>;
  /** Persist plugin-wide global settings. */
  setGlobalSettings<T extends JsonObject = JsonObject>(settings: T): Promise<void>;
  /** Subscribe to external global settings changes (e.g. from Property Inspector). */
  onGlobalSettingsChanged(callback: (settings: JsonObject) => void): void;

  // ── Action registration ───────────────────────────────────────
  //
  // The adapter creates the underlying event source (SingletonAction
  // for physical, WebSocket listener for web, etc.) and invokes the
  // provided callbacks when events arrive.  The library owns the
  // callback implementations; the adapter owns the event plumbing.
  registerAction(uuid: string, callbacks: AdapterActionCallbacks): void;

  // ── SDK utilities ─────────────────────────────────────────────
  /** Open a URL in the user's default browser. */
  openUrl(url: string): Promise<void>;
  /** Switch the active Stream Deck profile. */
  switchToProfile(deviceId: string, profile: string): Promise<void>;
  /** Send a payload to the Property Inspector. */
  sendToPropertyInspector(payload: JsonValue): Promise<void>;
}
