import type { ReactRoot } from "@/roots/root";
import type { TouchStripRoot } from "@/roots/touchstrip-root";
import type { CanvasInfo, DeviceInfo } from "@/types";
import type { VContainer } from "@/reconciler/vnode";
import type { RenderConfig, RenderProfile } from "@/render/pipeline";
import { metrics } from "@/render/metrics";
import type { RegistryObserver } from "./observers/lifecycle";
import type { DevtoolsServer } from "./server";
import type {
  ConsoleMessage,
  EventBusMessage,
  HighlightRenderMessage,
  LifecycleMessage,
  MetricsMessage,
  NetworkErrorMessage,
  NetworkRequestMessage,
  NetworkResponseMessage,
  ProfileData,
  RenderMessage,
  ServerInfoMessage,
  SnapshotAction,
  SnapshotMessage,
  SnapshotTouchStrip,
  TouchStripRenderMessage,
} from "./types";
import { serializeValue } from "./serialization/value";
import { serializeVNode } from "./serialization/vnode";
import { renderWithHighlight, renderTouchStripWithHighlight } from "./highlight";

// ── DevTools Bridge ─────────────────────────────────────────────────
//
// Central intelligence layer that connects all data sources to the
// SSE stream consumed by the browser-based devtools UI.
//
//   Data sources:                    Bridge                  Transport
//   ──────────────                  ──────                  ─────────
//   RootRegistry observer  ─┐
//   Render pipeline hook   ─┤
//   EventBus static hook   ─┼──→  DevtoolsBridge  ──→  DevtoolsServer (SSE)
//   Console interceptor    ─┤     (throttle, ring     ──→  Browser UI
//   Fetch interceptor      ─┘      buffers, snapshot)
//
// Key design decisions:
//
//   Ring buffers: bounded-capacity circular buffers for console,
//   network, and event history.  New clients receive the last N
//   messages via snapshot, not unbounded history.
//
//   Render throttling: leading+trailing-edge throttle at 100ms
//   (max 10 render messages/sec per action).  Prevents the SSE
//   stream from being overwhelmed during 30fps animation.
//
//   Highlight overlay: when the devtools UI hovers over a VNode,
//   the bridge renders a Chrome-DevTools-style highlight overlay
//   onto the hardware.  suppressHardwarePush on the root prevents
//   normal renders from overwriting the highlight.

// ── Ring Buffer ─────────────────────────────────────────────────────
// Fixed-capacity circular buffer.  When full, new items overwrite the
// oldest.  Used for bounded history of console/network/event messages
// so the snapshot sent to new clients has recent context without
// unbounded memory growth.  CONSOLE_RING=200, NETWORK_RING=100,
// EVENT_RING=200.

class RingBuffer<T> {
  private items: T[];
  private head = 0;
  private count = 0;

  constructor(private capacity: number) {
    this.items = new Array(capacity);
  }

  push(item: T): void {
    this.items[(this.head + this.count) % this.capacity] = item;
    if (this.count < this.capacity) {
      this.count++;
    } else {
      this.head = (this.head + 1) % this.capacity;
    }
  }

  toArray(): T[] {
    const result: T[] = [];
    for (let i = 0; i < this.count; i++) {
      result.push(this.items[(this.head + i) % this.capacity]!);
    }
    return result;
  }
}

// ── Action Metadata ─────────────────────────────────────────────────

interface ActionMeta {
  uuid: string;
  surface: "key" | "dial" | "touch";
  canvas: CanvasInfo;
  device: DeviceInfo;
  coordinates?: { column: number; row: number };
  root: ReactRoot;
}

interface TouchStripMeta {
  root: TouchStripRoot;
  deviceInfo: DeviceInfo;
  columns: Map<number, string>; // column → actionId
}

// ── DevTools Bridge ────────────────────────────────────────────────────

const RENDER_THROTTLE_MS = 100; // Max 10 render messages per second per action
const CONSOLE_RING_SIZE = 200;
const NETWORK_RING_SIZE = 100;
const EVENT_RING_SIZE = 200;

let consoleIdCounter = 0;
let eventIdCounter = 0;

export class DevtoolsBridge implements RegistryObserver {
  private server: DevtoolsServer;
  private devtoolsName: string;
  private renderConfig: RenderConfig;

  // Ring buffers for snapshot history
  private consoleRing = new RingBuffer<ConsoleMessage>(CONSOLE_RING_SIZE);
  private networkRing = new RingBuffer<
    NetworkRequestMessage | NetworkResponseMessage | NetworkErrorMessage
  >(NETWORK_RING_SIZE);
  private eventRing = new RingBuffer<EventBusMessage>(EVENT_RING_SIZE);

  // Action tracking
  private actions = new Map<string, ActionMeta>();
  private touchStrips = new Map<string, TouchStripMeta>();

  // Render throttling
  private lastRenderSent = new Map<string, number>();
  private pendingTrailing = new Map<string, ReturnType<typeof setTimeout>>();

  // EventBus → actionId mapping (for static observer path)
  private eventBusOwners = new Map<object, { actionId: string; uuid: string }>();

  // Highlight state
  private highlightedActionId: string | null = null;
  private highlightedNodeId: number | null = null;

  // Profile stashing (onProfile fires synchronously before onRender)
  private _lastProfile: RenderProfile | null = null;

  // Metrics emission timer
  private _metricsTimer: ReturnType<typeof setInterval> | null = null;

  constructor(server: DevtoolsServer, devtoolsName: string, renderConfig: RenderConfig) {
    this.server = server;
    this.devtoolsName = devtoolsName;
    this.renderConfig = renderConfig;

    // Handle client→server messages
    server.setOnMessage((msg) => {
      if (msg.type === "request:snapshot") {
        this.server.broadcast(this.buildSnapshot());
      } else if (msg.type === "highlight:action") {
        this.handleHighlight(msg.actionId, msg.nodeId).catch(() => {});
      }
    });

    // Handle new client connection — send info + snapshot to that client
    server.setOnConnect((clientId: string) => {
      const info: ServerInfoMessage = {
        type: "server:info",
        ts: Date.now(),
        version: "0.1.5",
        library: "@fcannizzaro/streamdeck-react",
        devtoolsName: this.devtoolsName,
      };
      this.server.send(clientId, info);
      this.server.send(clientId, this.buildSnapshot());
    });
  }

  // ── Registry Observer Implementation ──────────────────────────

  onRootCreated(
    actionId: string,
    root: ReactRoot,
    meta: {
      actionUuid: string;
      surface: "key" | "dial" | "touch";
      canvas: CanvasInfo;
      device: DeviceInfo;
      coordinates?: { column: number; row: number };
    },
  ): void {
    this.actions.set(actionId, {
      uuid: meta.actionUuid,
      surface: meta.surface,
      canvas: meta.canvas,
      device: meta.device,
      coordinates: meta.coordinates,
      root,
    });

    // Track EventBus owner for the static observer path
    this.eventBusOwners.set(root.eventBus, {
      actionId,
      uuid: meta.actionUuid,
    });

    // Emit lifecycle event
    const msg: LifecycleMessage = {
      type: "lifecycle",
      ts: Date.now(),
      event: "appear",
      actionId,
      actionUuid: meta.actionUuid,
      surface: meta.surface,
      device: {
        id: meta.device.id,
        type: meta.device.type as number,
        name: meta.device.name,
      },
      coordinates: meta.coordinates,
      canvas: { width: meta.canvas.width, height: meta.canvas.height },
    };
    this.server.broadcast(msg);
  }

  onRootDestroyed(actionId: string): void {
    // Clear highlight if this action was highlighted
    if (this.highlightedActionId === actionId) {
      this.highlightedActionId = null;
      this.highlightedNodeId = null;
    }

    const meta = this.actions.get(actionId);
    if (meta) {
      // Ensure normal pushes are re-enabled before cleanup
      meta.root.suppressHardwarePush = false;
      this.eventBusOwners.delete(meta.root.eventBus);
      this.actions.delete(actionId);

      const msg: LifecycleMessage = {
        type: "lifecycle",
        ts: Date.now(),
        event: "disappear",
        actionId,
        actionUuid: meta.uuid,
        surface: meta.surface,
        device: {
          id: meta.device.id,
          type: meta.device.type as number,
          name: meta.device.name,
        },
        coordinates: meta.coordinates,
        canvas: { width: meta.canvas.width, height: meta.canvas.height },
      };
      this.server.broadcast(msg);
    }

    // Clean up throttling state
    this.lastRenderSent.delete(actionId);
    const pending = this.pendingTrailing.get(actionId);
    if (pending) {
      clearTimeout(pending);
      this.pendingTrailing.delete(actionId);
    }
  }

  onTouchStripCreated(deviceId: string, root: TouchStripRoot, deviceInfo: DeviceInfo): void {
    this.touchStrips.set(deviceId, {
      root,
      deviceInfo,
      columns: new Map(),
    });
    this.eventBusOwners.set(root.eventBus, {
      actionId: `touchStrip:${deviceId}`,
      uuid: "",
    });
  }

  onTouchStripColumnChanged(
    deviceId: string,
    columns: number[],
    actionMap: Map<number, string>,
  ): void {
    const tb = this.touchStrips.get(deviceId);
    if (tb) {
      tb.columns = new Map(actionMap);
    }
  }

  onTouchStripDestroyed(deviceId: string): void {
    const tb = this.touchStrips.get(deviceId);
    if (tb) {
      this.eventBusOwners.delete(tb.root.eventBus);
    }
    this.touchStrips.delete(deviceId);
  }

  onDispatch(actionId: string, event: string, payload: unknown): void {
    if (!this.server.hasClients()) return;

    const meta = this.actions.get(actionId);
    const msg: EventBusMessage = {
      type: "event",
      ts: Date.now(),
      id: `e:${eventIdCounter++}`,
      actionId,
      actionUuid: meta?.uuid ?? "",
      event,
      payload: serializeValue(payload, 6),
    };

    this.eventRing.push(msg);
    this.server.broadcast(msg);
  }

  // ── EventBus Static Observer ──────────────────────────────────

  onEventBusEmit(bus: object, event: string, payload: unknown): void {
    if (!this.server.hasClients()) return;

    // Look up owner — if dispatched through registry, onDispatch already sent it
    const owner = this.eventBusOwners.get(bus);
    if (!owner) return;

    // Events dispatched through the registry already go through onDispatch.
    // The static observer captures events emitted directly on the bus
    // (willAppear, willDisappear, settingsChanged). To avoid duplicates,
    // we skip events that the registry dispatches.
    const registryEvents = new Set([
      "keyDown",
      "keyUp",
      "dialRotate",
      "dialDown",
      "dialUp",
      "touchTap",
      "sendToPlugin",
      "propertyInspectorDidAppear",
      "propertyInspectorDidDisappear",
      "titleParametersDidChange",
    ]);

    if (registryEvents.has(event)) return;

    const msg: EventBusMessage = {
      type: "event",
      ts: Date.now(),
      id: `e:${eventIdCounter++}`,
      actionId: owner.actionId,
      actionUuid: owner.uuid,
      event,
      payload: serializeValue(payload, 6),
    };

    this.eventRing.push(msg);
    this.server.broadcast(msg);
  }

  // ── Console Callback ──────────────────────────────────────────

  onConsole(level: string, args: unknown[], stack: string | undefined): void {
    if (!this.server.hasClients()) return;

    const msg: ConsoleMessage = {
      type: "console",
      ts: Date.now(),
      id: `c:${consoleIdCounter++}`,
      level: level as ConsoleMessage["level"],
      args: args.map((arg) => serializeValue(arg, 6)),
      stack,
    };

    this.consoleRing.push(msg);
    this.server.broadcast(msg);
  }

  // ── Profile Callback ──────────────────────────────────────────

  /**
   * Stash the render profile for the next onRender call.
   * In the pipeline, onProfile fires synchronously before onRender,
   * so the stash is always consumed immediately.
   */
  onProfile(profile: RenderProfile): void {
    this._lastProfile = profile;
  }

  // ── Metrics Emission ──────────────────────────────────────────

  private static readonly METRICS_INTERVAL_MS = 3_000;

  /** Start periodic metrics emission to connected devtools clients. */
  startMetricsEmitter(): void {
    if (this._metricsTimer) return;
    this._metricsTimer = setInterval(() => {
      if (!this.server.hasClients()) return;
      const snapshot = metrics.snapshot();
      const msg: MetricsMessage = {
        type: "metrics",
        ts: Date.now(),
        metrics: snapshot,
      };
      this.server.broadcast(msg);
    }, DevtoolsBridge.METRICS_INTERVAL_MS);
    // Don't prevent process exit
    if (typeof this._metricsTimer === "object" && "unref" in this._metricsTimer) {
      this._metricsTimer.unref();
    }
  }

  /** Stop periodic metrics emission. */
  stopMetricsEmitter(): void {
    if (this._metricsTimer) {
      clearInterval(this._metricsTimer);
      this._metricsTimer = null;
    }
  }

  // ── Fetch Callbacks ───────────────────────────────────────────

  onFetchRequest(
    id: string,
    method: string,
    url: string,
    headers: Record<string, string>,
    body?: string,
  ): void {
    const msg: NetworkRequestMessage = {
      type: "network:request",
      ts: Date.now(),
      id,
      method,
      url,
      headers,
      body,
    };

    this.networkRing.push(msg);
    this.server.broadcast(msg);
  }

  onFetchResponse(
    id: string,
    status: number,
    statusText: string,
    headers: Record<string, string>,
    body: string | undefined,
    durationMs: number,
  ): void {
    const msg: NetworkResponseMessage = {
      type: "network:response",
      ts: Date.now(),
      id,
      status,
      statusText,
      headers,
      body,
      durationMs,
    };

    this.networkRing.push(msg);
    this.server.broadcast(msg);
  }

  onFetchError(id: string, error: string, durationMs: number): void {
    const msg: NetworkErrorMessage = {
      type: "network:error",
      ts: Date.now(),
      id,
      error,
      durationMs,
    };

    this.networkRing.push(msg);
    this.server.broadcast(msg);
  }

  // ── Render Pipeline Callback ──────────────────────────────────
  //
  // Called by the render pipeline's config.onRender hook after a
  // successful render (key/dial) or after TouchStrip flush completes.
  //
  // Profile capture strategy:
  //
  //   The pipeline calls onProfile() synchronously BEFORE onRender(),
  //   stashing the RenderProfile in _lastProfile.  We MUST consume it
  //   eagerly at the top of onRender — before any async throttle
  //   delays — because:
  //
  //     1. A trailing-edge setTimeout would fire AFTER _lastProfile
  //        has been overwritten by a subsequent render's profile.
  //     2. A different action's render could interleave and consume
  //        the wrong profile.
  //
  //   By capturing immediately, we bind the profile to the correct
  //   container/action and pass it through the throttle/emit chain:
  //
  //     onProfile(p)    onRender(container, dataUri)
  //       │                │
  //       ▼                ▼
  //     _lastProfile ──→ captured here (consumed, _lastProfile = null)
  //                        │
  //                        ├─ action? → throttledRender(…, profile)
  //                        │              │
  //                        │              ├─ leading edge → emitRender(…, profile)
  //                        │              └─ trailing edge → setTimeout → emitRender(…, profile)
  //                        │                    (profile was captured before the delay)
  //                        │
  //                        └─ touchStrip? → emitTouchStripRender(…, profile)
  //

  onRender(container: VContainer, dataUri: string): void {
    if (!this.server.hasClients()) return;

    // ── Eagerly consume the stashed profile ─────────────────────
    // Must happen BEFORE any async work (throttle setTimeout) to
    // avoid the profile being overwritten by a later render cycle.
    const profile = this._lastProfile;
    this._lastProfile = null;

    // Find which action this container belongs to
    let actionId: string | null = null;
    let meta: ActionMeta | null = null;

    for (const [id, m] of this.actions) {
      if (m.root.vcontainer === container) {
        actionId = id;
        meta = m;
        break;
      }
    }

    if (actionId && meta) {
      // Store the last data URI on the root
      meta.root.lastDataUri = dataUri;
      this.throttledRender(actionId, container, dataUri, meta, profile);

      // Re-apply highlight overlay after normal render completes.
      // With suppressHardwarePush active, doFlush won't push the normal
      // image to hardware, so we just need to re-render the highlight.
      if (this.highlightedActionId === actionId && this.highlightedNodeId !== null) {
        this.applyHighlight(actionId, this.highlightedNodeId, meta).catch(() => {});
      }

      return;
    }

    // Check TouchStrip roots
    for (const [deviceId, tb] of this.touchStrips) {
      if (tb.root.vcontainer === container) {
        this.emitTouchStripRender(deviceId, tb, profile);

        // Re-apply highlight overlay after TouchStrip render completes.
        // Same pattern as the key/dial re-apply above — when a
        // highlight is active, the normal render updated lastSegmentUris
        // but skipped hardware push (suppressHardwarePush is true),
        // so we need to re-render the highlight with the new tree.
        const tbActionId = `${DevtoolsBridge.TB_PREFIX}${deviceId}`;
        if (this.highlightedActionId === tbActionId && this.highlightedNodeId !== null) {
          this.applyTouchStripHighlight(tbActionId, deviceId, this.highlightedNodeId, tb).catch(
            () => {},
          );
        }

        return;
      }
    }
  }

  // ── Render Throttle ───────────────────────────────────────────
  //
  // Leading + trailing edge throttle at RENDER_THROTTLE_MS (100ms).
  // Prevents the SSE stream from being overwhelmed during 30fps
  // animation while ensuring the latest frame is always delivered.
  //
  // The `profile` parameter is captured eagerly in onRender() and
  // passed through to emitRender().  On the trailing edge, the
  // profile is captured in the setTimeout closure — it's the
  // profile that was active when the throttle was triggered, not
  // when the timeout fires.  This preserves the correct
  // profile ↔ render association.
  //
  //   time ─────────────────────────────────────────────────→
  //
  //   render₁ (leading)    render₂ (throttled)     trailing fires
  //      │                     │                       │
  //      ├─ emit immediately   ├─ profile captured     ├─ emit with
  //      │  with profile₁      │  as profile₂          │  profile₂
  //      │                     │  in closure            │  (not stale)
  //      ▼                     └─ setTimeout ───────────┘

  private throttledRender(
    actionId: string,
    container: VContainer,
    dataUri: string,
    meta: ActionMeta,
    profile: RenderProfile | null,
  ): void {
    const now = Date.now();
    const last = this.lastRenderSent.get(actionId) ?? 0;
    const elapsed = now - last;

    // Clear any pending trailing send
    const pending = this.pendingTrailing.get(actionId);
    if (pending) clearTimeout(pending);

    if (elapsed >= RENDER_THROTTLE_MS) {
      this.emitRender(actionId, container, dataUri, meta, now, profile);
      this.lastRenderSent.set(actionId, now);
    } else {
      // Schedule trailing-edge send.
      // `profile` is captured in this closure — safe from overwrite.
      this.pendingTrailing.set(
        actionId,
        setTimeout(() => {
          this.emitRender(actionId, container, dataUri, meta, Date.now(), profile);
          this.lastRenderSent.set(actionId, Date.now());
          this.pendingTrailing.delete(actionId);
        }, RENDER_THROTTLE_MS - elapsed),
      );
    }
  }

  private emitRender(
    actionId: string,
    container: VContainer,
    dataUri: string,
    meta: ActionMeta,
    ts: number,
    profile: RenderProfile | null,
  ): void {
    const tree = serializeVNode(container);

    const msg: RenderMessage = {
      type: "render",
      ts,
      actionId,
      actionUuid: meta.uuid,
      surface: meta.surface,
      canvas: { width: meta.canvas.width, height: meta.canvas.height },
      tree,
      dataUri,
      renderMs: profile?.totalMs ?? 0,
      ...(profile ? { profile: this.toProfileData(profile) } : {}),
    };
    this.server.broadcast(msg);
  }

  /** Convert internal RenderProfile to wire-protocol ProfileData. */
  private toProfileData(profile: RenderProfile): ProfileData {
    return {
      vnodeConversionMs: profile.vnodeConversionMs,
      takumiRenderMs: profile.takumiRenderMs,
      hashMs: profile.hashMs,
      base64Ms: profile.base64Ms,
      totalMs: profile.totalMs,
      skipped: profile.skipped,
      cacheHit: profile.cacheHit,
      treeDepth: profile.treeDepth,
      nodeCount: profile.nodeCount,
    };
  }

  // ── TouchStrip Render Emission ────────────────────────────────────
  //
  // Emits a "render:touchStrip" SSE message with the serialized VNode
  // tree, per-segment data URIs, and the pipeline timing profile.
  //
  // Unlike key/dial renders (which have one data URI), TouchStrip
  // renders produce per-column segment URIs stored in
  // tb.root.lastSegmentUris.  The profile covers the full-width
  // Takumi render (renderToRaw) that produced the raw RGBA buffer
  // which was then sliced into segments.
  //
  //   emitTouchStripRender(deviceId, tb, profile)
  //     │
  //     ├─ serializeVNode(container)     → tree snapshot
  //     ├─ tb.root.lastSegmentUris       → per-column data URIs
  //     ├─ toProfileData(profile)        → wire-format timing
  //     │
  //     └─ broadcast "render:touchStrip" message
  //          → SSE stream → devtools Performance Panel

  private emitTouchStripRender(
    deviceId: string,
    tb: TouchStripMeta,
    profile: RenderProfile | null,
  ): void {
    const tree = serializeVNode(tb.root.vcontainer);
    const segments: TouchStripRenderMessage["segments"] = [];
    for (const [column, actionId] of tb.columns) {
      const uri = tb.root.lastSegmentUris.get(column);
      if (uri) {
        segments.push({ column, actionId, dataUri: uri });
      }
    }

    const msg: TouchStripRenderMessage = {
      type: "render:touchStrip",
      ts: Date.now(),
      deviceId,
      canvas: { width: tb.root.vcontainer.children.length * 200, height: 100 },
      tree,
      segments,
      renderMs: profile?.totalMs ?? 0,
      ...(profile ? { profile: this.toProfileData(profile) } : {}),
    };
    this.server.broadcast(msg);
  }

  // ── Highlight Handling ──────────────────────────────────────────
  //
  // When the user hovers a node in the Elements panel, the devtools
  // UI sends a "highlight:action" message with (actionId, nodeId).
  // The bridge re-renders the image with a translucent blue overlay
  // on the target node and pushes it to both:
  //   - The physical hardware (suppress normal renders + pushImage)
  //   - The devtools browser preview (SSE "highlight:render" message)
  //
  // Two paths:
  //   - Key/dial: actionId is a plain string, looked up in this.actions
  //   - TouchStrip: actionId is "touchStrip:<deviceId>", looked up in
  //     this.touchStrips.  Requires per-segment slicing since the
  //     TouchStrip pushes 200×100 segments, not a single image.
  //
  //   handleHighlight(actionId, nodeId)
  //     │
  //     ├─ restore previous highlight (un-suppress, push original)
  //     │
  //     ├─ actionId starts with "touchStrip:" ?
  //     │    ├─ YES → lookup this.touchStrips → applyTouchStripHighlight()
  //     │    └─ NO  → lookup this.actions   → applyHighlight()
  //     │
  //     └─ broadcast "highlight:render" → devtools UI preview

  private static readonly TB_PREFIX = "touchStrip:";

  private async handleHighlight(actionId: string | null, nodeId: number | null): Promise<void> {
    try {
      const prevId = this.highlightedActionId;
      this.highlightedActionId = actionId;
      this.highlightedNodeId = nodeId;

      // Restore previous action/TouchStrip to its normal state
      if (prevId && prevId !== actionId) {
        await this.restoreHighlight(prevId);
        this.broadcastHighlightClear(prevId);
      }

      if (!actionId || nodeId === null) {
        // Clear highlight — restore current target if it was highlighted
        if (actionId && prevId === actionId) {
          await this.restoreHighlight(actionId);
          this.broadcastHighlightClear(actionId);
        }
        this.highlightedActionId = null;
        this.highlightedNodeId = null;
        return;
      }

      // Route to the correct highlight path
      if (actionId.startsWith(DevtoolsBridge.TB_PREFIX)) {
        const deviceId = actionId.slice(DevtoolsBridge.TB_PREFIX.length);
        const tb = this.touchStrips.get(deviceId);
        if (!tb) {
          this.highlightedActionId = null;
          this.highlightedNodeId = null;
          return;
        }
        tb.root.suppressHardwarePush = true;
        await this.applyTouchStripHighlight(actionId, deviceId, nodeId, tb);
      } else {
        const meta = this.actions.get(actionId);
        if (!meta) {
          this.highlightedActionId = null;
          this.highlightedNodeId = null;
          return;
        }
        meta.root.suppressHardwarePush = true;
        await this.applyHighlight(actionId, nodeId, meta);
      }
    } catch {
      // Never crash the plugin for a devtools feature
    }
  }

  /**
   * Restore a highlighted action or TouchStrip to its normal state.
   * Un-suppresses hardware pushes and restores the original image(s).
   */
  private async restoreHighlight(id: string): Promise<void> {
    if (id.startsWith(DevtoolsBridge.TB_PREFIX)) {
      const deviceId = id.slice(DevtoolsBridge.TB_PREFIX.length);
      const tb = this.touchStrips.get(deviceId);
      if (tb) {
        tb.root.suppressHardwarePush = false;
        // Restore the original per-segment images to hardware
        await tb.root.pushSegmentImages(tb.root.lastSegmentUris);
      }
    } else {
      const prevMeta = this.actions.get(id);
      if (prevMeta) {
        prevMeta.root.suppressHardwarePush = false;
        if (prevMeta.root.lastDataUri) {
          await prevMeta.root.pushImage(prevMeta.root.lastDataUri).catch(() => {});
        }
      }
    }
  }

  private async applyHighlight(actionId: string, nodeId: number, meta: ActionMeta): Promise<void> {
    try {
      const uri = await renderWithHighlight(
        meta.root.vcontainer,
        meta.canvas.width,
        meta.canvas.height,
        this.renderConfig,
        nodeId,
      );

      // Guard: highlight may have changed while rendering
      if (uri && this.highlightedActionId === actionId && this.highlightedNodeId === nodeId) {
        await meta.root.pushImage(uri);
        // Send the highlighted image to the devtools UI for preview
        this.broadcastHighlightRender(actionId, uri);
      }
    } catch {
      // Silently ignore highlight render failures
    }
  }

  // ── TouchStrip Highlight ──────────────────────────────────────────
  //
  // Renders the full TouchStrip tree with a highlight overlay, then:
  //   - Pushes per-column segments to the physical hardware
  //   - Sends per-segment highlight URIs to the devtools browser
  //     preview (one "highlight:render" message per column, keyed
  //     as "touchStrip:<deviceId>:seg:<col>")
  //
  // Why per-segment instead of a single full-width image?
  //   The TouchStrip preview renders each segment as a separate 200×100
  //   <img>.  A single full-width image (e.g. 800×100) displayed via
  //   the canvas width/height attributes gets squished when the
  //   dimensions don't match.  Per-segment URIs avoid this entirely.
  //
  //   applyTouchStripHighlight(actionId, deviceId, nodeId, tb)
  //     │
  //     ├─ renderTouchStripWithHighlight(container, fullWidth, ...)
  //     │    └─ returns segmentUris (Map<col, uri>)
  //     │
  //     ├─ tb.root.pushSegmentImages(segmentUris) → physical device
  //     │
  //     └─ for each (col, uri):
  //          broadcastHighlightRender("touchStrip:<deviceId>:seg:<col>", uri)

  private async applyTouchStripHighlight(
    actionId: string,
    deviceId: string,
    nodeId: number,
    tb: TouchStripMeta,
  ): Promise<void> {
    try {
      // Compute TouchStrip geometry from active columns.
      // Each column is 200×100 pixels; full width = max column span.
      const columns = tb.root.columnNumbers;
      if (columns.length === 0) return;

      const segmentWidth = 200;
      const segmentHeight = 100;
      const fullWidth = (Math.max(...columns) + 1) * segmentWidth;

      const result = await renderTouchStripWithHighlight(
        tb.root.vcontainer,
        fullWidth,
        segmentHeight,
        columns,
        segmentWidth,
        this.renderConfig,
        nodeId,
      );

      // Guard: highlight may have changed while rendering
      if (result && this.highlightedActionId === actionId && this.highlightedNodeId === nodeId) {
        await tb.root.pushSegmentImages(result.segmentUris);
        // Broadcast per-segment highlight URIs to devtools preview.
        for (const [col, uri] of result.segmentUris) {
          this.broadcastHighlightRender(`${actionId}:seg:${col}`, uri);
        }
      }
    } catch {
      // Silently ignore TouchStrip highlight render failures
    }
  }

  /** Broadcast highlight render image (or null to clear) to devtools UI. */
  private broadcastHighlightRender(actionId: string, dataUri: string | null): void {
    const msg: HighlightRenderMessage = {
      type: "highlight:render",
      ts: Date.now(),
      actionId,
      dataUri,
    };
    this.server.broadcast(msg);
  }

  /**
   * Clear highlight URIs for the given actionId.
   * For TouchStrip IDs, clears all per-segment keys (touchStrip:*:seg:N).
   * For regular actions, clears the single actionId key.
   */
  private broadcastHighlightClear(id: string): void {
    if (id.startsWith(DevtoolsBridge.TB_PREFIX)) {
      const deviceId = id.slice(DevtoolsBridge.TB_PREFIX.length);
      const tb = this.touchStrips.get(deviceId);
      if (tb) {
        for (const col of tb.root.columnNumbers) {
          this.broadcastHighlightRender(`${id}:seg:${col}`, null);
        }
      }
    } else {
      this.broadcastHighlightRender(id, null);
    }
  }

  // ── Snapshot Builder ──────────────────────────────────────────

  buildSnapshot(): SnapshotMessage {
    const actions: SnapshotAction[] = [];
    for (const [actionId, meta] of this.actions) {
      let tree = null;
      try {
        tree = serializeVNode(meta.root.vcontainer);
      } catch {
        /* ignore serialization errors */
      }

      actions.push({
        actionId,
        actionUuid: meta.uuid,
        surface: meta.surface,
        canvas: { width: meta.canvas.width, height: meta.canvas.height },
        device: {
          id: meta.device.id,
          type: meta.device.type as number,
          name: meta.device.name,
        },
        coordinates: meta.coordinates,
        tree,
        dataUri: meta.root.lastDataUri,
      });
    }

    const touchStrips: SnapshotTouchStrip[] = [];
    for (const [deviceId, tb] of this.touchStrips) {
      let tree = null;
      try {
        tree = serializeVNode(tb.root.vcontainer);
      } catch {
        /* ignore */
      }

      const segments: SnapshotTouchStrip["segments"] = [];
      for (const [column, actionId] of tb.columns) {
        segments.push({
          column,
          actionId,
          dataUri: tb.root.lastSegmentUris.get(column) ?? null,
        });
      }

      touchStrips.push({
        deviceId,
        deviceName: tb.deviceInfo.name,
        canvas: {
          width: tb.columns.size * 200,
          height: 100,
        },
        tree,
        segments,
      });
    }

    return {
      type: "snapshot",
      ts: Date.now(),
      actions,
      touchStrips,
      recentConsole: this.consoleRing.toArray(),
      recentNetwork: this.networkRing.toArray(),
      recentEvents: this.eventRing.toArray(),
      metrics: metrics.snapshot(),
    };
  }
}
