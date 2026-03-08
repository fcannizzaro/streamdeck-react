// ── Protocol Message Types ───────────────────────────────────────────
// Shared type definitions for the devtools WebSocket protocol.
// Plugin runs a WS server; browser connects directly.

// ── Serialized Value ────────────────────────────────────────────────

export type SerializedValue =
  | { t: "s"; v: string }
  | { t: "n"; v: number }
  | { t: "b"; v: boolean }
  | { t: "null" }
  | { t: "undef" }
  | { t: "obj"; v: Record<string, SerializedValue>; circular?: true }
  | { t: "arr"; v: SerializedValue[] }
  | { t: "err"; name: string; message: string; stack?: string }
  | { t: "fn"; name: string }
  | { t: "sym"; v: string }
  | { t: "bigint"; v: string }
  | { t: "buf"; byteLength: number }
  | { t: "trunc"; hint: string };

// ── Serialized VNode ────────────────────────────────────────────────

export interface SerializedVNode {
  /** Monotonic integer ID, unique within a single tree snapshot. */
  nid: number;
  /** Element type: "div", "span", "img", "#text", "container" */
  type: string;
  /** Props with values serialized via serializeValue(). */
  props: Record<string, SerializedValue>;
  /** Children. */
  children: SerializedVNode[];
  /** Text content (only for #text nodes). */
  text?: string;
}

// ── Base Message ────────────────────────────────────────────────────

export interface BaseMessage {
  type: string;
  ts: number;
}

// ── Server → Client Messages (Plugin Server → Browser) ──────────────

export interface ServerInfoMessage extends BaseMessage {
  type: "server:info";
  version: string;
  library: string;
  devtoolsName: string;
}

export interface SnapshotAction {
  actionId: string;
  actionUuid: string;
  surface: "key" | "dial" | "touch";
  canvas: { width: number; height: number };
  device: { id: string; type: number; name: string };
  coordinates?: { column: number; row: number };
  tree: SerializedVNode | null;
  dataUri: string | null;
}

export interface SnapshotTouchBar {
  deviceId: string;
  deviceName: string;
  canvas: { width: number; height: number };
  tree: SerializedVNode | null;
  segments: Array<{
    column: number;
    actionId: string;
    dataUri: string | null;
  }>;
}

export interface SnapshotMessage extends BaseMessage {
  type: "snapshot";
  actions: SnapshotAction[];
  touchBars: SnapshotTouchBar[];
  recentConsole: ConsoleMessage[];
  recentNetwork: (NetworkRequestMessage | NetworkResponseMessage | NetworkErrorMessage)[];
  recentEvents: EventBusMessage[];
}

export interface ConsoleMessage extends BaseMessage {
  type: "console";
  id: string;
  level: "log" | "warn" | "error" | "info" | "debug";
  args: SerializedValue[];
  stack?: string;
}

export interface NetworkRequestMessage extends BaseMessage {
  type: "network:request";
  id: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface NetworkResponseMessage extends BaseMessage {
  type: "network:response";
  id: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body?: string;
  durationMs: number;
}

export interface NetworkErrorMessage extends BaseMessage {
  type: "network:error";
  id: string;
  error: string;
  durationMs: number;
}

export interface RenderMessage extends BaseMessage {
  type: "render";
  actionId: string;
  actionUuid: string;
  surface: "key" | "dial" | "touch";
  canvas: { width: number; height: number };
  tree: SerializedVNode;
  dataUri: string;
  renderMs: number;
}

export interface TouchBarRenderMessage extends BaseMessage {
  type: "render:touchbar";
  deviceId: string;
  canvas: { width: number; height: number };
  tree: SerializedVNode;
  segments: Array<{
    column: number;
    actionId: string;
    dataUri: string;
  }>;
  renderMs: number;
}

export interface EventBusMessage extends BaseMessage {
  type: "event";
  id: string;
  actionId: string;
  actionUuid: string;
  event: string;
  payload: SerializedValue;
}

export interface LifecycleMessage extends BaseMessage {
  type: "lifecycle";
  event: "appear" | "disappear";
  actionId: string;
  actionUuid: string;
  surface: "key" | "dial" | "touch" | "touchbar";
  device: { id: string; type: number; name: string };
  coordinates?: { column: number; row: number };
  canvas: { width: number; height: number };
}

export interface HighlightRenderMessage extends BaseMessage {
  type: "highlight:render";
  /** The action whose highlight was rendered. */
  actionId: string;
  /** Data URI of the rendered image with highlight overlay, or null to clear. */
  dataUri: string | null;
}

export interface PongMessage extends BaseMessage {
  type: "pong";
}

// ── Client → Server Messages (Browser → Plugin Server) ──────────────

export interface RequestSnapshotMessage extends BaseMessage {
  type: "request:snapshot";
}

export interface PingMessage extends BaseMessage {
  type: "ping";
}

export interface HighlightActionMessage extends BaseMessage {
  type: "highlight:action";
  /** The action ID to highlight, or null to clear the highlight. */
  actionId: string | null;
  /** The VNode nid to highlight within the action, or null to clear. */
  nodeId: number | null;
}

// ── Union Types ─────────────────────────────────────────────────────

/** Messages the plugin server sends to browser clients. */
export type ServerMessage =
  | ServerInfoMessage
  | SnapshotMessage
  | ConsoleMessage
  | NetworkRequestMessage
  | NetworkResponseMessage
  | NetworkErrorMessage
  | RenderMessage
  | TouchBarRenderMessage
  | EventBusMessage
  | LifecycleMessage
  | HighlightRenderMessage
  | PongMessage;

/** Messages browser clients send to the plugin server. */
export type ClientMessage =
  | RequestSnapshotMessage
  | PingMessage
  | HighlightActionMessage;
