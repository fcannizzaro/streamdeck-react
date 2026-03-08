import type { WebSocket } from "ws";
import type { ReactRoot } from "@/roots/root";
import type { TouchBarRoot } from "@/roots/touchbar-root";
import type { CanvasInfo, DeviceInfo } from "@/types";
import type { VContainer } from "@/reconciler/vnode";
import type { RenderConfig } from "@/render/pipeline";
import type { RegistryObserver } from "./observers/lifecycle";
import type { DevtoolsServer } from "./server";
import type {
  ConsoleMessage,
  EventBusMessage,
  HighlightRenderMessage,
  LifecycleMessage,
  NetworkErrorMessage,
  NetworkRequestMessage,
  NetworkResponseMessage,
  RenderMessage,
  ServerInfoMessage,
  SnapshotAction,
  SnapshotMessage,
  SnapshotTouchBar,
  TouchBarRenderMessage,
} from "./types";
import { serializeValue } from "./serialization/value";
import { serializeVNode } from "./serialization/vnode";
import { renderWithHighlight } from "./highlight";

// ── Ring Buffer ─────────────────────────────────────────────────────

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

  clear(): void {
    this.head = 0;
    this.count = 0;
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

interface TouchBarMeta {
  root: TouchBarRoot;
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
  private touchBars = new Map<string, TouchBarMeta>();

  // Render throttling
  private lastRenderSent = new Map<string, number>();
  private pendingTrailing = new Map<string, ReturnType<typeof setTimeout>>();

  // EventBus → actionId mapping (for static observer path)
  private eventBusOwners = new Map<object, { actionId: string; uuid: string }>();

  // Highlight state
  private highlightedActionId: string | null = null;
  private highlightedNodeId: number | null = null;

  constructor(server: DevtoolsServer, devtoolsName: string, renderConfig: RenderConfig) {
    this.server = server;
    this.devtoolsName = devtoolsName;
    this.renderConfig = renderConfig;

    // Handle client→server messages
    server.setOnMessage((msg) => {
      if (msg.type === "request:snapshot") {
        this.server.broadcast(this.buildSnapshot());
      } else if (msg.type === "ping") {
        this.server.broadcast({ type: "pong", ts: Date.now() });
      } else if (msg.type === "highlight:action") {
        this.handleHighlight(msg.actionId, msg.nodeId).catch(() => {});
      }
    });

    // Handle new client connection — send info + snapshot to that client
    server.setOnConnect((ws: WebSocket) => {
      const info: ServerInfoMessage = {
        type: "server:info",
        ts: Date.now(),
        version: "0.1.5",
        library: "@fcannizzaro/streamdeck-react",
        devtoolsName: this.devtoolsName,
      };
      this.server.send(ws, info);
      this.server.send(ws, this.buildSnapshot());
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

  onTouchBarCreated(
    deviceId: string,
    root: TouchBarRoot,
    deviceInfo: DeviceInfo,
  ): void {
    this.touchBars.set(deviceId, {
      root,
      deviceInfo,
      columns: new Map(),
    });
    this.eventBusOwners.set(root.eventBus, {
      actionId: `touchbar:${deviceId}`,
      uuid: "",
    });
  }

  onTouchBarColumnChanged(
    deviceId: string,
    columns: number[],
    actionMap: Map<number, string>,
  ): void {
    const tb = this.touchBars.get(deviceId);
    if (tb) {
      tb.columns = new Map(actionMap);
    }
  }

  onTouchBarDestroyed(deviceId: string): void {
    const tb = this.touchBars.get(deviceId);
    if (tb) {
      this.eventBusOwners.delete(tb.root.eventBus);
    }
    this.touchBars.delete(deviceId);
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

  onRender(container: VContainer, dataUri: string): void {
    if (!this.server.hasClients()) return;

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
      this.throttledRender(actionId, container, dataUri, meta);

      // Re-apply highlight overlay after normal render completes.
      // With suppressHardwarePush active, doFlush won't push the normal
      // image to hardware, so we just need to re-render the highlight.
      if (this.highlightedActionId === actionId && this.highlightedNodeId !== null) {
        this.applyHighlight(actionId, this.highlightedNodeId, meta).catch(() => {});
      }

      return;
    }

    // Check touchbar roots
    for (const [deviceId, tb] of this.touchBars) {
      if (tb.root.vcontainer === container) {
        this.emitTouchBarRender(deviceId, tb);
        return;
      }
    }
  }

  private throttledRender(
    actionId: string,
    container: VContainer,
    dataUri: string,
    meta: ActionMeta,
  ): void {
    const now = Date.now();
    const last = this.lastRenderSent.get(actionId) ?? 0;
    const elapsed = now - last;

    // Clear any pending trailing send
    const pending = this.pendingTrailing.get(actionId);
    if (pending) clearTimeout(pending);

    if (elapsed >= RENDER_THROTTLE_MS) {
      this.emitRender(actionId, container, dataUri, meta, now);
      this.lastRenderSent.set(actionId, now);
    } else {
      // Schedule trailing-edge send
      this.pendingTrailing.set(
        actionId,
        setTimeout(() => {
          this.emitRender(actionId, container, dataUri, meta, Date.now());
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
      renderMs: 0,
    };
    this.server.broadcast(msg);
  }

  private emitTouchBarRender(
    deviceId: string,
    tb: TouchBarMeta,
  ): void {
    const tree = serializeVNode(tb.root.vcontainer);
    const segments: TouchBarRenderMessage["segments"] = [];
    for (const [column, actionId] of tb.columns) {
      const uri = tb.root.lastSegmentUris.get(column);
      if (uri) {
        segments.push({ column, actionId, dataUri: uri });
      }
    }

    const msg: TouchBarRenderMessage = {
      type: "render:touchbar",
      ts: Date.now(),
      deviceId,
      canvas: { width: tb.root.vcontainer.children.length * 200, height: 100 },
      tree,
      segments,
      renderMs: 0,
    };
    this.server.broadcast(msg);
  }

  // ── Highlight Handling ──────────────────────────────────────────

  private async handleHighlight(actionId: string | null, nodeId: number | null): Promise<void> {
    try {
      const prevId = this.highlightedActionId;
      this.highlightedActionId = actionId;
      this.highlightedNodeId = nodeId;

      // Restore previous action to its normal image and re-enable normal pushes
      if (prevId && prevId !== actionId) {
        const prevMeta = this.actions.get(prevId);
        if (prevMeta) {
          prevMeta.root.suppressHardwarePush = false;
          if (prevMeta.root.lastDataUri) {
            await prevMeta.root.pushImage(prevMeta.root.lastDataUri).catch(() => {});
          }
        }
        // Tell browser to clear highlight preview for previous action
        this.broadcastHighlightRender(prevId, null);
      }

      if (!actionId || nodeId === null) {
        // Clear highlight — restore current action too if it was highlighted
        if (actionId && prevId === actionId) {
          const meta = this.actions.get(actionId);
          if (meta) {
            meta.root.suppressHardwarePush = false;
            if (meta.root.lastDataUri) {
              await meta.root.pushImage(meta.root.lastDataUri).catch(() => {});
            }
          }
          // Tell browser to clear highlight preview
          this.broadcastHighlightRender(actionId, null);
        }
        this.highlightedActionId = null;
        this.highlightedNodeId = null;
        return;
      }

      const meta = this.actions.get(actionId);
      if (!meta) {
        this.highlightedActionId = null;
        this.highlightedNodeId = null;
        return;
      }

      // Suppress normal hardware pushes while highlight is active
      meta.root.suppressHardwarePush = true;
      await this.applyHighlight(actionId, nodeId, meta);
    } catch {
      // Never crash the plugin for a devtools feature
    }
  }

  private async applyHighlight(
    actionId: string,
    nodeId: number,
    meta: ActionMeta,
  ): Promise<void> {
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

    const touchBars: SnapshotTouchBar[] = [];
    for (const [deviceId, tb] of this.touchBars) {
      let tree = null;
      try {
        tree = serializeVNode(tb.root.vcontainer);
      } catch {
        /* ignore */
      }

      const segments: SnapshotTouchBar["segments"] = [];
      for (const [column, actionId] of tb.columns) {
        segments.push({
          column,
          actionId,
          dataUri: tb.root.lastSegmentUris.get(column) ?? null,
        });
      }

      touchBars.push({
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
      touchBars,
      recentConsole: this.consoleRing.toArray(),
      recentNetwork: this.networkRing.toArray(),
      recentEvents: this.eventRing.toArray(),
    };
  }
}
