import { create } from "zustand";
import type {
  ServerInfoMessage,
  ConsoleMessage,
  NetworkEntry,
  ActionEntry,
  TouchStripEntry,
  EventBusMessage,
  ServerMessage,
  SerializedVNode,
  DiscoveredPlugin,
  MetricsData,
  ProfileEntry,
} from "../types";

// ── Max stored items ────────────────────────────────────────────────

const MAX_CONSOLE = 1000;
const MAX_NETWORK = 500;
const MAX_EVENTS = 1000;
const MAX_PROFILES = 200;

// ── Persist selected plugin name ────────────────────────────────────

const SELECTED_PLUGIN_KEY = "sdreact:selected-plugin";
const PLUGIN_PORTS_KEY = "sdreact:plugin-ports";

function getPersistedPluginName(): string | null {
  try {
    return localStorage.getItem(SELECTED_PLUGIN_KEY);
  } catch {
    return null;
  }
}

function persistPluginName(name: string | null) {
  try {
    if (name) {
      localStorage.setItem(SELECTED_PLUGIN_KEY, name);
    } else {
      localStorage.removeItem(SELECTED_PLUGIN_KEY);
    }
  } catch {}
}

// ── Persist known plugin ports (stable across restarts) ─────────────

function getPersistedPluginPorts(): Record<string, number> {
  try {
    const raw = localStorage.getItem(PLUGIN_PORTS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function persistPluginPorts(plugins: DiscoveredPlugin[]) {
  try {
    const map = getPersistedPluginPorts();
    for (const p of plugins) {
      map[p.devtoolsName] = p.port;
    }
    localStorage.setItem(PLUGIN_PORTS_KEY, JSON.stringify(map));
  } catch {}
}

// ── Store Interface ─────────────────────────────────────────────────

let profileIdCounter = 0;

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
  /** True when the selected plugin disconnected and we're waiting for it to reconnect. */
  waitingForReconnect: boolean;
  /** Info about the disconnected plugin we're waiting for. */
  disconnectedPlugin: DiscoveredPlugin | null;

  // Console
  consoleLogs: ConsoleMessage[];
  consoleFilter: { levels: Set<string>; search: string };

  // Network
  networkRequests: Map<string, NetworkEntry>;
  networkOrder: string[];
  selectedRequestId: string | null;

  // Elements
  actions: Map<string, ActionEntry>;
  touchStrips: Map<string, TouchStripEntry>;
  selectedActionId: string | null;
  selectedNodeId: number | null;
  hoveredNodeId: number | null;

  // Highlight preview (server-rendered image with highlight overlay)
  highlightDataUri: Map<string, string>; // actionId → highlighted data URI

  // Events
  events: EventBusMessage[];
  eventFilter: { types: Set<string>; search: string };

  // Performance
  metrics: MetricsData | null;
  profileHistory: ProfileEntry[];

  // Actions
  setScanning: (scanning: boolean) => void;
  addPlugin: (plugin: DiscoveredPlugin) => void;
  removePlugin: (port: number) => void;
  handleMessage: (port: number, msg: ServerMessage) => void;
  selectPlugin: (port: number | null) => void;
  clearConsole: () => void;
  clearNetwork: () => void;
  clearEvents: () => void;
  clearProfiles: () => void;
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
    touchStrips: new Map<string, TouchStripEntry>(),
    selectedActionId: null,
    selectedNodeId: null,
    hoveredNodeId: null,
    highlightDataUri: new Map<string, string>(),
    metrics: null as MetricsData | null,
    profileHistory: [] as ProfileEntry[],
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
  waitingForReconnect: false,
  disconnectedPlugin: null,

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
  touchStrips: new Map(),
  selectedActionId: null,
  selectedNodeId: null,
  hoveredNodeId: null,

  // Highlight preview
  highlightDataUri: new Map(),

  // Events
  events: [],
  eventFilter: { types: new Set<string>(), search: "" },

  // Performance
  metrics: null,
  profileHistory: [],

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
    // Check if the selected plugin is reconnecting
    const isReconnect = state.waitingForReconnect && state.selectedPort === plugin.port;
    // Auto-select: prefer persisted plugin, fall back to first found.
    // If a preferred name is stored but doesn't match this plugin,
    // still select it so the UI isn't stuck waiting for a plugin that
    // may never appear.  The preference is kept in localStorage so
    // that if the preferred plugin connects later, the user can switch.
    let selectedPort = state.selectedPort;
    if (selectedPort === null) {
      const preferredName = getPersistedPluginName();
      if (preferredName && plugin.devtoolsName === preferredName) {
        // Preferred plugin found — select it
        selectedPort = plugin.port;
      } else if (!preferredName) {
        // No preference persisted — select first found and remember it
        selectedPort = plugin.port;
        persistPluginName(plugin.devtoolsName);
      } else {
        // Preferred plugin not yet found — select this one as a
        // fallback so the UI is functional, but don't overwrite the
        // persisted preference.
        selectedPort = plugin.port;
      }
    }
    set({
      plugins,
      selectedPort,
      ...(isReconnect ? { waitingForReconnect: false, disconnectedPlugin: null } : {}),
    });
    // Persist known ports to localStorage (stable across restarts)
    persistPluginPorts(plugins);
  },

  removePlugin: (port) => {
    const state = get();
    const remaining = state.plugins.filter((p) => p.port !== port);
    if (state.selectedPort === port) {
      // Already waiting for reconnect on this port — just update plugin list
      if (state.waitingForReconnect) {
        set({ plugins: remaining });
      } else {
        // Selected plugin disconnected — keep selectedPort, wait for reconnect
        const disconnectedPlugin = state.plugins.find((p) => p.port === port) ?? null;
        set({
          plugins: remaining,
          waitingForReconnect: true,
          disconnectedPlugin,
          ...emptyDataState(),
        });
      }
    } else {
      set({ plugins: remaining });
    }
  },

  selectPlugin: (port) => {
    const state = get();
    const plugin = state.plugins.find((p) => p.port === port);
    persistPluginName(plugin?.devtoolsName ?? null);
    set({
      selectedPort: port,
      waitingForReconnect: false,
      disconnectedPlugin: null,
      ...emptyDataState(),
    });
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

        const touchStrips = new Map<string, TouchStripEntry>();
        for (const tb of msg.touchStrips) {
          const segments = new Map<number, { actionId: string; dataUri: string | null }>();
          for (const s of tb.segments) {
            segments.set(s.column, {
              actionId: s.actionId,
              dataUri: s.dataUri,
            });
          }
          touchStrips.set(tb.deviceId, {
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

        // Auto-select first action (or TouchStrip) if none selected.
        // The selectedActionId can be either a plain actionId or a
        // "touchStrip:<deviceId>" string — check both maps.
        const TB_PREFIX = "touchStrip:";
        const prevId = state.selectedActionId;
        const prevStillValid =
          prevId != null &&
          (actions.has(prevId) ||
            (prevId.startsWith(TB_PREFIX) && touchStrips.has(prevId.slice(TB_PREFIX.length))));

        const selectedActionId = prevStillValid
          ? prevId
          : actions.size > 0
            ? (actions.keys().next().value ?? null)
            : touchStrips.size > 0
              ? `${TB_PREFIX}${touchStrips.keys().next().value ?? ""}`
              : null;

        set({
          actions,
          touchStrips,
          consoleLogs: msg.recentConsole.slice(-MAX_CONSOLE),
          networkRequests,
          networkOrder,
          events: msg.recentEvents.slice(-MAX_EVENTS),
          selectedActionId,
          metrics: msg.metrics ?? null,
          profileHistory: [],
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

        // Append profile to history if present
        const updates: Partial<DevtoolsState> = { actions };
        if (msg.profile) {
          const entry: ProfileEntry = {
            ...msg.profile,
            id: `p:${profileIdCounter++}`,
            actionId: msg.actionId,
            actionUuid: msg.actionUuid,
            ts: msg.ts,
          };
          const profiles = [...state.profileHistory, entry];
          if (profiles.length > MAX_PROFILES) profiles.splice(0, profiles.length - MAX_PROFILES);
          updates.profileHistory = profiles;
        }
        set(updates);
        break;
      }

      case "render:touchStrip": {
        const touchStrips = new Map(state.touchStrips);
        const existing = touchStrips.get(msg.deviceId);
        const segments = new Map(existing?.segments ?? new Map());
        for (const s of msg.segments) {
          segments.set(s.column, {
            actionId: s.actionId,
            dataUri: s.dataUri,
          });
        }
        touchStrips.set(msg.deviceId, {
          deviceId: msg.deviceId,
          deviceName: existing?.deviceName ?? "Unknown",
          canvas: msg.canvas,
          tree: msg.tree,
          segments,
        });

        // ── Append TouchStrip profile to history ──────────────────
        // Same pattern as the "render" case: if the message
        // includes a pipeline timing profile, create a ProfileEntry
        // and append it to the rolling profileHistory buffer.
        // Uses `touchStrip:<deviceId>` as the actionId to distinguish
        // TouchStrip profiles from key/dial profiles in the
        // Performance panel.
        const updates: Partial<DevtoolsState> = { touchStrips };
        if (msg.profile) {
          const entry: ProfileEntry = {
            ...msg.profile,
            id: `p:${profileIdCounter++}`,
            actionId: `touchStrip:${msg.deviceId}`,
            actionUuid: "",
            ts: msg.ts,
          };
          const profiles = [...state.profileHistory, entry];
          if (profiles.length > MAX_PROFILES) profiles.splice(0, profiles.length - MAX_PROFILES);
          updates.profileHistory = profiles;
        }
        set(updates);
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

      case "metrics": {
        set({ metrics: msg.metrics });
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
  clearProfiles: () => set({ profileHistory: [] }),

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
