// ── Protocol Message Types ───────────────────────────────────────────
// Mirrored from packages/streamdeck-react/src/devtools/types.ts
// Browser-side types for the devtools UI (SSE + fetch POST).

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
  nid: number;
  type: string;
  props: Record<string, SerializedValue>;
  children: SerializedVNode[];
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

export interface SnapshotTouchStrip {
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
  touchStrips: SnapshotTouchStrip[];
  recentConsole: ConsoleMessage[];
  recentNetwork: (NetworkRequestMessage | NetworkResponseMessage | NetworkErrorMessage)[];
  recentEvents: EventBusMessage[];
  metrics?: MetricsData;
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
  profile?: ProfileData;
}

export interface TouchStripRenderMessage extends BaseMessage {
  type: "render:touchStrip";
  deviceId: string;
  canvas: { width: number; height: number };
  tree: SerializedVNode;
  segments: Array<{
    column: number;
    actionId: string;
    dataUri: string;
  }>;
  renderMs: number;
  /** Per-render pipeline timing profile, when available. */
  profile?: ProfileData;
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
  surface: "key" | "dial" | "touch" | "touchStrip";
  device: { id: string; type: number; name: string };
  coordinates?: { column: number; row: number };
  canvas: { width: number; height: number };
}

export interface HighlightRenderMessage extends BaseMessage {
  type: "highlight:render";
  actionId: string;
  dataUri: string | null;
}

// ── Performance Data ────────────────────────────────────────────────

/** Per-render pipeline timing data, embedded in RenderMessage. */
export interface ProfileData {
  vnodeToElementMs: number;
  fromJsxMs: number;
  takumiRenderMs: number;
  hashMs: number;
  base64Ms: number;
  totalMs: number;
  skipped: boolean;
  cacheHit: boolean;
  treeDepth: number;
  nodeCount: number;
}

/** Aggregate render metrics snapshot. */
export interface MetricsData {
  flushCount: number;
  renderCount: number;
  cacheHitCount: number;
  dirtySkipCount: number;
  hashDedupCount: number;
  avgRenderMs: number;
  peakRenderMs: number;
  imageCacheBytes: number;
  touchStripCacheBytes: number;
}

export interface MetricsMessage extends BaseMessage {
  type: "metrics";
  metrics: MetricsData;
}

// ── Client → Server Messages (Browser → Plugin Server) ──────────────

export interface RequestSnapshotMessage extends BaseMessage {
  type: "request:snapshot";
}

export interface HighlightActionMessage extends BaseMessage {
  type: "highlight:action";
  actionId: string | null;
  nodeId: number | null;
}

// ── Union Types ─────────────────────────────────────────────────────

/** Messages the plugin server sends to browser clients (via SSE). */
export type ServerMessage =
  | ServerInfoMessage
  | SnapshotMessage
  | ConsoleMessage
  | NetworkRequestMessage
  | NetworkResponseMessage
  | NetworkErrorMessage
  | RenderMessage
  | TouchStripRenderMessage
  | EventBusMessage
  | LifecycleMessage
  | HighlightRenderMessage
  | MetricsMessage;

/** Messages browser clients send to the plugin server (via POST /message). */
export type ClientMessage = RequestSnapshotMessage | HighlightActionMessage;

// ── Derived Types for UI ────────────────────────────────────────────

export interface NetworkEntry {
  request: NetworkRequestMessage;
  response?: NetworkResponseMessage;
  error?: NetworkErrorMessage;
}

export interface ActionEntry {
  actionId: string;
  actionUuid: string;
  surface: "key" | "dial" | "touch";
  canvas: { width: number; height: number };
  device: { id: string; type: number; name: string };
  coordinates?: { column: number; row: number };
  tree: SerializedVNode | null;
  dataUri: string | null;
}

export interface TouchStripEntry {
  deviceId: string;
  deviceName: string;
  canvas: { width: number; height: number };
  tree: SerializedVNode | null;
  segments: Map<number, { actionId: string; dataUri: string | null }>;
}

/** Discovered plugin from port scanning. */
export interface DiscoveredPlugin {
  port: number;
  devtoolsName: string;
  version: string;
  library: string;
  connectedAt: number;
}

/** Per-render profile entry stored in the UI, with action context. */
export interface ProfileEntry extends ProfileData {
  id: string;
  actionId: string;
  actionUuid: string;
  ts: number;
}
