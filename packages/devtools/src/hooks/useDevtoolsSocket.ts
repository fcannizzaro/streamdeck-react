import { useEffect, useRef, useCallback } from "react";
import { useStore } from "./useStore";
import type { ServerMessage, ClientMessage } from "../types";

// ── Port Scanning Hook (SSE) ────────────────────────────────────────
// Scans ports 39400-39499 to discover running devtools servers.
//
// Discovery uses lightweight `fetch("/health")` probes — much faster
// than WebSocket and immune to browser per-host connection limits.
//
// Once a server is found, an EventSource (SSE) connection streams
// server→client messages.  Client→server messages are sent via
// `fetch POST /message`.
//
// When persisted ports exist (from sessionStorage), they are probed
// ALONE first (Phase 1).  Only if none connect does the full port
// scan run (Phase 2).  This avoids flooding the connection pool.
//
// An automatic re-scan runs every AUTOSCAN_INTERVAL_MS when there
// are no active connections, to pick up plugins started after load.

const PORT_MIN = 39400;
const PORT_MAX = 39499;
const PROBE_TIMEOUT_MS = 2000;
const STAGGER_MS = 5; // ms between each probe in full scan
const AUTOSCAN_INTERVAL_MS = 60_000;
const RECONNECT_PROBE_MS = 5_000;
const HEALTH_CHECK_MS = 10_000;
const HEALTH_CHECK_TIMEOUT_MS = 3_000;

/** Read last-known plugin ports from localStorage (stable across restarts). */
function getPersistedPorts(): number[] {
  try {
    const raw = localStorage.getItem("sdreact:plugin-ports");
    if (!raw) return [];
    const map = JSON.parse(raw) as Record<string, number>;
    return Object.values(map);
  } catch {
    return [];
  }
}

export function useDevtoolsSocket(): {
  requestSnapshot: (port: number) => void;
  send: (port: number, msg: ClientMessage) => void;
  scan: () => void;
} {
  // Map of port → EventSource for active SSE connections
  const connectionsRef = useRef<Map<number, EventSource>>(new Map());
  // Ports currently being probed (to avoid duplicate attempts)
  const probingRef = useRef<Set<number>>(new Set());
  // Timers for cleanup
  const staggerTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  // AbortControllers for in-flight fetch probes
  const abortControllersRef = useRef<Set<AbortController>>(new Set());

  const handleMessage = useStore((s) => s.handleMessage);
  const addPlugin = useStore((s) => s.addPlugin);
  const removePlugin = useStore((s) => s.removePlugin);
  const setScanning = useStore((s) => s.setScanning);
  const setBlocked = useStore((s) => s.setBlocked);

  // ── Stable refs for async callbacks ──────────────────────────
  const handleMessageRef = useRef(handleMessage);
  handleMessageRef.current = handleMessage;

  const addPluginRef = useRef(addPlugin);
  addPluginRef.current = addPlugin;

  const removePluginRef = useRef(removePlugin);
  removePluginRef.current = removePlugin;

  // connectSSE — establishes an EventSource connection to a discovered server.
  // Called after a successful /health probe.  Stable (no deps).
  const connectSSE = useCallback((port: number) => {
    if (connectionsRef.current.has(port)) return;

    const es = new EventSource(`http://127.0.0.1:${port}/events`);

    es.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as ServerMessage;
        if (msg.type === "server:info") {
          connectionsRef.current.set(port, es);
          addPluginRef.current({
            port,
            devtoolsName: msg.devtoolsName,
            version: msg.version,
            library: msg.library,
            connectedAt: Date.now(),
          });
          return;
        }
        handleMessageRef.current(port, msg);
      } catch {
        // Ignore malformed messages
      }
    };

    es.onerror = () => {
      // EventSource will auto-reconnect on transient errors.
      // If the server is truly gone, readyState will be CLOSED.
      if (es.readyState === EventSource.CLOSED) {
        es.close();
        const wasTracked = connectionsRef.current.get(port) === es;
        if (wasTracked) {
          connectionsRef.current.delete(port);
          removePluginRef.current(port);
        }
      }
    };
  }, []);

  // probePort — lightweight HTTP probe via fetch("/health").
  // If the server responds, we establish an SSE connection.  Stable (no deps).
  const probePort = useCallback(
    (port: number) => {
      if (connectionsRef.current.has(port)) return;
      if (probingRef.current.has(port)) return;

      probingRef.current.add(port);

      const controller = new AbortController();
      abortControllersRef.current.add(controller);
      const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

      fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal })
        .then((res) => {
          clearTimeout(timeout);
          abortControllersRef.current.delete(controller);
          probingRef.current.delete(port);
          if (res.ok) connectSSE(port);
        })
        .catch(() => {
          clearTimeout(timeout);
          abortControllersRef.current.delete(controller);
          probingRef.current.delete(port);
        });
    },
    [connectSSE],
  );

  // scan — two-phase: persisted ports first, then full scan if needed.
  // Stable because probePort is stable and zustand setters are stable.
  const scan = useCallback(() => {
    // ── Defensive cleanup ──────────────────────────────────────
    for (const [port, es] of connectionsRef.current) {
      if (es.readyState === EventSource.CLOSED) {
        es.close();
        connectionsRef.current.delete(port);
        removePluginRef.current(port);
      }
    }
    probingRef.current.clear();

    // Cancel any in-progress probes from previous scan
    for (const t of staggerTimersRef.current) clearTimeout(t);
    staggerTimersRef.current = [];
    for (const c of abortControllersRef.current) {
      try {
        c.abort();
      } catch {
        /* ignore */
      }
    }
    abortControllersRef.current.clear();

    setScanning(true);

    const priorityPorts = getPersistedPorts().filter((p) => p >= PORT_MIN && p <= PORT_MAX);

    if (priorityPorts.length > 0) {
      // ── Phase 1: probe persisted ports ONLY ──────────────────
      for (const port of priorityPorts) {
        probePort(port);
      }

      // Wait for priority probes to resolve, then always run full scan
      // to discover any new plugins on ports not in sessionStorage.
      // probePort already skips ports with active connections.
      const phase1Timer = setTimeout(() => {
        startFullScan();
      }, PROBE_TIMEOUT_MS + 200);
      staggerTimersRef.current.push(phase1Timer);
    } else {
      startFullScan();
    }

    function startFullScan() {
      let delay = 0;
      for (let port = PORT_MIN; port <= PORT_MAX; port++) {
        const t = setTimeout(() => probePort(port), delay);
        staggerTimersRef.current.push(t);
        delay += STAGGER_MS;
      }

      const totalMs = delay + PROBE_TIMEOUT_MS + 100;
      const doneTimer = setTimeout(() => {
        setScanning(false);
        if (connectionsRef.current.size === 0 && location.protocol === "https:") {
          setBlocked(true);
        }
      }, totalMs);
      staggerTimersRef.current.push(doneTimer);
    }
  }, [probePort, setScanning, setBlocked]);

  useEffect(() => {
    // Initial scan on mount
    scan();

    // Auto-rescan every 60s when no connections are active
    const autoscanTimer = setInterval(() => {
      if (connectionsRef.current.size === 0) {
        scan();
      }
    }, AUTOSCAN_INTERVAL_MS);

    return () => {
      clearInterval(autoscanTimer);
      for (const t of staggerTimersRef.current) clearTimeout(t);
      staggerTimersRef.current = [];
      for (const c of abortControllersRef.current) {
        try {
          c.abort();
        } catch {
          /* ignore */
        }
      }
      abortControllersRef.current.clear();
      for (const es of connectionsRef.current.values()) {
        es.close();
      }
      connectionsRef.current.clear();
      probingRef.current.clear();
    };
  }, [scan]);

  // Auto-reconnect: when waiting for a plugin to reconnect, probe its port frequently
  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setInterval> | null = null;

    const unsub = useStore.subscribe((state, prev) => {
      const shouldProbe = state.waitingForReconnect && state.selectedPort !== null;
      const wasProbing = prev.waitingForReconnect && prev.selectedPort !== null;

      if (shouldProbe && !wasProbing) {
        // Start reconnect probing
        const port = state.selectedPort!;
        probePort(port);
        reconnectTimer = setInterval(() => probePort(port), RECONNECT_PROBE_MS);
      } else if (!shouldProbe && wasProbing) {
        // Stop reconnect probing
        if (reconnectTimer) {
          clearInterval(reconnectTimer);
          reconnectTimer = null;
        }
      }
    });

    // Check initial state
    const { waitingForReconnect, selectedPort } = useStore.getState();
    if (waitingForReconnect && selectedPort !== null) {
      probePort(selectedPort);
      reconnectTimer = setInterval(() => probePort(selectedPort), RECONNECT_PROBE_MS);
    }

    return () => {
      unsub();
      if (reconnectTimer) clearInterval(reconnectTimer);
    };
  }, [probePort]);

  // Periodic health check: probe all connected plugins to detect unresponsive servers
  useEffect(() => {
    const healthCheckTimer = setInterval(() => {
      for (const [port, es] of connectionsRef.current) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

        fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal })
          .then((res) => {
            clearTimeout(timeout);
            if (!res.ok) throw new Error("unhealthy");
          })
          .catch(() => {
            clearTimeout(timeout);
            // Health check failed — treat as disconnection
            es.close();
            if (connectionsRef.current.get(port) === es) {
              connectionsRef.current.delete(port);
              removePluginRef.current(port);
            }
          });
      }
    }, HEALTH_CHECK_MS);

    return () => clearInterval(healthCheckTimer);
  }, []);

  const requestSnapshot = useCallback((port: number) => {
    const d = encodeURIComponent(JSON.stringify({ type: "request:snapshot", ts: Date.now() }));
    fetch(`http://127.0.0.1:${port}/message?d=${d}`, { mode: "no-cors" }).catch(() => {});
  }, []);

  const send = useCallback((port: number, msg: ClientMessage) => {
    const d = encodeURIComponent(JSON.stringify(msg));
    fetch(`http://127.0.0.1:${port}/message?d=${d}`, { mode: "no-cors" }).catch(() => {});
  }, []);

  // Sync hover state → highlight:action messages to plugin
  useEffect(() => {
    const unsub = useStore.subscribe((state, prevState) => {
      const derivedAction = state.hoveredNodeId !== null ? state.selectedActionId : null;
      const prevDerivedAction =
        prevState.hoveredNodeId !== null ? prevState.selectedActionId : null;
      const derivedNode = state.hoveredNodeId;
      const prevDerivedNode = prevState.hoveredNodeId;

      if (derivedAction === prevDerivedAction && derivedNode === prevDerivedNode) return;

      const port = state.selectedPort;
      if (port === null) return;

      send(port, {
        type: "highlight:action",
        ts: Date.now(),
        actionId: derivedAction,
        nodeId: derivedNode,
      });
    });

    return unsub;
  }, [send]);

  return { requestSnapshot, send, scan };
}
