import { create } from "zustand";
import type {
  ServerInfoMessage,
  ConsoleMessage,
  NetworkEntry,
  ActionEntry,
  TouchBarEntry,
  EventBusMessage,
  ServerMessage,
  SerializedVNode,
  DiscoveredPlugin,
} from "../types";

// ── Max stored items ────────────────────────────────────────────────

const MAX_CONSOLE = 1000;
const MAX_NETWORK = 500;
const MAX_EVENTS = 1000;

// ── Store Interface ─────────────────────────────────────────────────

export interface DevtoolsState {
  // Scanning
  scanning: boolean;

  // Connection
  serverInfo: ServerInfoMessage | null;
  /** True when probe reached a devtools server but SSE was blocked (e.g. mixed content on HTTPS). */
  blocked: boolean;

  // Plugin discovery
  plugins: DiscoveredPlugin[];
  selectedPort: number | null;

  // Console
  consoleLogs: ConsoleMessage[];
  consoleFilter: { levels: Set<string>; search: string };

  // Network
  networkRequests: Map<string, NetworkEntry>;
  networkOrder: string[];
  selectedRequestId: string | null;

  // Elements
  actions: Map<string, ActionEntry>;
  touchBars: Map<string, TouchBarEntry>;
  selectedActionId: string | null;
  selectedNodeId: number | null;
  hoveredNodeId: number | null;

  // Highlight preview (server-rendered image with highlight overlay)
  highlightDataUri: Map<string, string>; // actionId → highlighted data URI

  // Events
  events: EventBusMessage[];
  eventFilter: { types: Set<string>; search: string };

  // Actions
  setScanning: (scanning: boolean) => void;
  addPlugin: (plugin: DiscoveredPlugin) => void;
  removePlugin: (port: number) => void;
  handleMessage: (port: number, msg: ServerMessage) => void;
  selectPlugin: (port: number | null) => void;
  clearConsole: () => void;
  clearNetwork: () => void;
  clearEvents: () => void;
  setConsoleFilter: (filter: Partial<{ levels: Set<string>; search: string }>) => void;
  setEventFilter: (filter: Partial<{ types: Set<string>; search: string }>) => void;
  setSelectedAction: (id: string | null) => void;
  setSelectedNode: (nid: number | null) => void;
  setHoveredNode: (nid: number | null) => void;
  setSelectedRequest: (id: string | null) => void;
  setBlocked: (blocked: boolean) => void;
}

// ── Helper: clear all data panels ───────────────────────────────────

function emptyDataState() {
  return {
    serverInfo: null,
    consoleLogs: [] as ConsoleMessage[],
    networkRequests: new Map<string, NetworkEntry>(),
    networkOrder: [] as string[],
    selectedRequestId: null,
    events: [] as EventBusMessage[],
    actions: new Map<string, ActionEntry>(),
    touchBars: new Map<string, TouchBarEntry>(),
    selectedActionId: null,
    selectedNodeId: null,
    hoveredNodeId: null,
    highlightDataUri: new Map<string, string>(),
  };
}

// ── Store ───────────────────────────────────────────────────────────

export const useStore = create<DevtoolsState>((set, get) => ({
  // Scanning
  scanning: false,

  // Connection
  serverInfo: null,
  blocked: false,

  // Plugin discovery
  plugins: [],
  selectedPort: null,

  // Console
  consoleLogs: [],
  consoleFilter: {
    levels: new Set(["log", "warn", "error", "info", "debug"]),
    search: "",
  },

  // Network
  networkRequests: new Map(),
  networkOrder: [],
  selectedRequestId: null,

  // Elements
  actions: new Map(),
  touchBars: new Map(),
  selectedActionId: null,
  selectedNodeId: null,
  hoveredNodeId: null,

  // Highlight preview
  highlightDataUri: new Map(),

  // Events
  events: [],
  eventFilter: { types: new Set<string>(), search: "" },

  // Actions
  setScanning: (scanning) => set({ scanning, ...(scanning ? { blocked: false } : {}) }),

  addPlugin: (plugin) => {
    const state = get();
    // Update existing or add new
    const existing = state.plugins.findIndex((p) => p.port === plugin.port);
    let plugins: DiscoveredPlugin[];
    if (existing >= 0) {
      plugins = [...state.plugins];
      plugins[existing] = plugin;
    } else {
      plugins = [...state.plugins, plugin];
    }
    // Auto-select if nothing selected
    const selectedPort = state.selectedPort ?? plugin.port;
    set({ plugins, selectedPort });
    // Persist known ports for fast reconnect on reload
    try {
      sessionStorage.setItem("sdreact:ports", JSON.stringify(plugins.map((p) => p.port)));
    } catch {}
  },

  removePlugin: (port) => {
    const state = get();
    const remaining = state.plugins.filter((p) => p.port !== port);
    if (state.selectedPort === port) {
      // Selected plugin disconnected — clear data, pick next
      const nextPort = remaining.length > 0 ? remaining[0].port : null;
      set({
        plugins: remaining,
        selectedPort: nextPort,
        ...emptyDataState(),
      });
    } else {
      set({ plugins: remaining });
    }
    // Update persisted ports
    try {
      if (remaining.length > 0) {
        sessionStorage.setItem("sdreact:ports", JSON.stringify(remaining.map((p) => p.port)));
      } else {
        sessionStorage.removeItem("sdreact:ports");
      }
    } catch {}
  },

  selectPlugin: (port) => {
    set({ selectedPort: port, ...emptyDataState() });
  },

  handleMessage: (port: number, msg: ServerMessage) => {
    const state = get();
    // Only process messages from the selected plugin
    if (state.selectedPort !== port) return;

    switch (msg.type) {
      case "server:info":
        set({ serverInfo: msg });
        break;

      case "snapshot": {
        // Hydrate all state
        const actions = new Map<string, ActionEntry>();
        for (const a of msg.actions) {
          actions.set(a.actionId, { ...a });
        }

        const touchBars = new Map<string, TouchBarEntry>();
        for (const tb of msg.touchBars) {
          const segments = new Map<number, { actionId: string; dataUri: string | null }>();
          for (const s of tb.segments) {
            segments.set(s.column, {
              actionId: s.actionId,
              dataUri: s.dataUri,
            });
          }
          touchBars.set(tb.deviceId, {
            deviceId: tb.deviceId,
            deviceName: tb.deviceName,
            canvas: tb.canvas,
            tree: tb.tree,
            segments,
          });
        }

        // Rebuild network from snapshot
        const networkRequests = new Map<string, NetworkEntry>();
        const networkOrder: string[] = [];
        for (const item of msg.recentNetwork) {
          if (item.type === "network:request") {
            networkRequests.set(item.id, { request: item });
            networkOrder.push(item.id);
          } else if (item.type === "network:response") {
            const entry = networkRequests.get(item.id);
            if (entry) entry.response = item;
          } else if (item.type === "network:error") {
            const entry = networkRequests.get(item.id);
            if (entry) entry.error = item;
          }
        }

        // Auto-select first action if none selected
        const selectedActionId =
          state.selectedActionId && actions.has(state.selectedActionId)
            ? state.selectedActionId
            : actions.size > 0
              ? (actions.keys().next().value ?? null)
              : null;

        set({
          actions,
          touchBars,
          consoleLogs: msg.recentConsole.slice(-MAX_CONSOLE),
          networkRequests,
          networkOrder,
          events: msg.recentEvents.slice(-MAX_EVENTS),
          selectedActionId,
        });
        break;
      }

      case "console": {
        const logs = [...state.consoleLogs, msg];
        if (logs.length > MAX_CONSOLE) logs.splice(0, logs.length - MAX_CONSOLE);
        set({ consoleLogs: logs });
        break;
      }

      case "network:request": {
        const reqs = new Map(state.networkRequests);
        reqs.set(msg.id, { request: msg });
        const order = [...state.networkOrder, msg.id];
        if (order.length > MAX_NETWORK) {
          const removed = order.splice(0, order.length - MAX_NETWORK);
          for (const id of removed) reqs.delete(id);
        }
        set({ networkRequests: reqs, networkOrder: order });
        break;
      }

      case "network:response": {
        const reqs = new Map(state.networkRequests);
        const entry = reqs.get(msg.id);
        if (entry) {
          reqs.set(msg.id, { ...entry, response: msg });
          set({ networkRequests: reqs });
        }
        break;
      }

      case "network:error": {
        const reqs = new Map(state.networkRequests);
        const entry = reqs.get(msg.id);
        if (entry) {
          reqs.set(msg.id, { ...entry, error: msg });
          set({ networkRequests: reqs });
        }
        break;
      }

      case "render": {
        const actions = new Map(state.actions);
        const existing = actions.get(msg.actionId);
        if (existing) {
          actions.set(msg.actionId, {
            ...existing,
            tree: msg.tree,
            dataUri: msg.dataUri,
          });
        } else {
          actions.set(msg.actionId, {
            actionId: msg.actionId,
            actionUuid: msg.actionUuid,
            surface: msg.surface,
            canvas: msg.canvas,
            device: { id: "", type: 0, name: "Unknown" },
            tree: msg.tree,
            dataUri: msg.dataUri,
          });
        }
        set({ actions });
        break;
      }

      case "render:touchbar": {
        const touchBars = new Map(state.touchBars);
        const existing = touchBars.get(msg.deviceId);
        const segments = new Map(existing?.segments ?? new Map());
        for (const s of msg.segments) {
          segments.set(s.column, {
            actionId: s.actionId,
            dataUri: s.dataUri,
          });
        }
        touchBars.set(msg.deviceId, {
          deviceId: msg.deviceId,
          deviceName: existing?.deviceName ?? "Unknown",
          canvas: msg.canvas,
          tree: msg.tree,
          segments,
        });
        set({ touchBars });
        break;
      }

      case "highlight:render": {
        const map = new Map(state.highlightDataUri);
        if (msg.dataUri) {
          map.set(msg.actionId, msg.dataUri);
        } else {
          map.delete(msg.actionId);
        }
        set({ highlightDataUri: map });
        break;
      }

      case "event": {
        const events = [...state.events, msg];
        if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
        set({ events });
        break;
      }

      case "lifecycle": {
        if (msg.event === "appear") {
          const actions = new Map(state.actions);
          actions.set(msg.actionId, {
            actionId: msg.actionId,
            actionUuid: msg.actionUuid,
            surface: msg.surface as "key" | "dial" | "touch",
            canvas: msg.canvas,
            device: msg.device,
            coordinates: msg.coordinates,
            tree: null,
            dataUri: null,
          });
          const selectedActionId = state.selectedActionId ?? msg.actionId;
          set({ actions, selectedActionId });
        } else {
          const actions = new Map(state.actions);
          actions.delete(msg.actionId);
          const selectedActionId =
            state.selectedActionId === msg.actionId
              ? actions.size > 0
                ? (actions.keys().next().value ?? null)
                : null
              : state.selectedActionId;
          set({ actions, selectedActionId });
        }
        break;
      }
    }
  },

  clearConsole: () => set({ consoleLogs: [] }),
  clearNetwork: () =>
    set({
      networkRequests: new Map(),
      networkOrder: [],
      selectedRequestId: null,
    }),
  clearEvents: () => set({ events: [] }),

  setConsoleFilter: (filter) => set((s) => ({ consoleFilter: { ...s.consoleFilter, ...filter } })),
  setEventFilter: (filter) => set((s) => ({ eventFilter: { ...s.eventFilter, ...filter } })),

  setSelectedAction: (id) => set({ selectedActionId: id, selectedNodeId: null }),
  setSelectedNode: (nid) => set({ selectedNodeId: nid }),
  setHoveredNode: (nid) => set({ hoveredNodeId: nid }),
  setSelectedRequest: (id) => set({ selectedRequestId: id }),
  setBlocked: (blocked) => set({ blocked }),
}));

// ── Selectors ───────────────────────────────────────────────────────

export function findNodeByNid(tree: SerializedVNode | null, nid: number): SerializedVNode | null {
  if (!tree) return null;
  if (tree.nid === nid) return tree;
  for (const child of tree.children) {
    const found = findNodeByNid(child, nid);
    if (found) return found;
  }
  return null;
}
