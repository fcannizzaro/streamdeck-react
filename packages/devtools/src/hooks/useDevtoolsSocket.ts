import { useEffect, useRef, useCallback } from "react";
import { useStore } from "./useStore";
import type { ServerMessage, ClientMessage } from "../types";

// ── Port Scanning Hook ──────────────────────────────────────────────
// Scans ports 39400-39499 to discover running devtools servers.
// Probes are staggered to avoid overwhelming browser connection limits.
// Dead connections are detected via ping/pong timeout and evicted at
// the start of each scan so the port gets re-probed.
//
// Scanning is NOT continuous — one scan runs on mount, and subsequent
// scans are triggered manually via the returned `scan` function.

const PORT_MIN = 39400;
const PORT_MAX = 39499;
const PING_INTERVAL_MS = 10_000; // ping every 10s for fast dead-connection detection
const PONG_TIMEOUT_MS = 15_000; // close connection if no pong in 15s
const CONNECT_TIMEOUT_MS = 2000;
const STAGGER_MS = 5; // ms between each probe

export function useDevtoolsSocket(): {
  requestSnapshot: (port: number) => void;
  send: (port: number, msg: ClientMessage) => void;
  scan: () => void;
} {
  // Map of port → WebSocket for active connections
  const connectionsRef = useRef<Map<number, WebSocket>>(new Map());
  // Ports currently being probed (to avoid duplicate attempts)
  const probingRef = useRef<Set<number>>(new Set());
  // Last pong timestamp per port — for dead-connection detection
  const lastPongRef = useRef<Map<number, number>>(new Map());
  // Timers for cleanup
  const staggerTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleMessage = useStore((s) => s.handleMessage);
  const addPlugin = useStore((s) => s.addPlugin);
  const removePlugin = useStore((s) => s.removePlugin);
  const setScanning = useStore((s) => s.setScanning);
  const setBlocked = useStore((s) => s.setBlocked);

  const handleMessageForPort = useCallback(
    (port: number, msg: ServerMessage) => {
      if (msg.type === "server:info") {
        addPlugin({
          port,
          devtoolsName: msg.devtoolsName,
          version: msg.version,
          library: msg.library,
          connectedAt: Date.now(),
        });
        return;
      }
      // Track pong for dead-connection detection
      if (msg.type === "pong") {
        lastPongRef.current.set(port, Date.now());
        return;
      }
      handleMessage(port, msg);
    },
    [handleMessage, addPlugin],
  );

  const probePort = useCallback(
    (port: number) => {
      // Skip if already connected or probing
      if (connectionsRef.current.has(port) || probingRef.current.has(port)) {
        return;
      }

      probingRef.current.add(port);

      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      const timeout = setTimeout(() => {
        probingRef.current.delete(port);
        if (ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      }, CONNECT_TIMEOUT_MS);

      ws.onopen = () => {
        clearTimeout(timeout);
        probingRef.current.delete(port);
        connectionsRef.current.set(port, ws);
        lastPongRef.current.set(port, Date.now()); // assume alive on connect
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as ServerMessage;
          handleMessageForPort(port, msg);
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        clearTimeout(timeout);
        probingRef.current.delete(port);
        lastPongRef.current.delete(port);
        if (connectionsRef.current.get(port) === ws) {
          connectionsRef.current.delete(port);
          removePlugin(port);
        }
      };

      ws.onerror = () => {
        // onclose will fire after this
      };
    },
    [handleMessageForPort, removePlugin],
  );

  // ── HTTP probe: detect extension blocking ──────────────────────────
  // After WS scan finds nothing, try HTTP fetch to the same ports.
  // If HTTP succeeds but WS didn't, an extension is blocking WebSocket.
  const probeHttpForBlocking = useCallback(async () => {
    // Only relevant when WS scan found nothing
    if (connectionsRef.current.size > 0) return;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);

    try {
      // Probe a few ports concurrently (not all 100 — just enough to detect)
      const ports = Array.from({ length: PORT_MAX - PORT_MIN + 1 }, (_, i) => PORT_MIN + i);
      const results = await Promise.allSettled(
        ports.map((port) =>
          fetch(`http://127.0.0.1:${port}`, { signal: controller.signal, mode: "cors" }).then(
            (res) => res.ok,
          ),
        ),
      );
      const anyReachable = results.some((r) => r.status === "fulfilled" && r.value);
      if (anyReachable && connectionsRef.current.size === 0) {
        setBlocked(true);
      }
    } catch {
      // Ignore — probing is best-effort
    } finally {
      clearTimeout(timeout);
    }
  }, [setBlocked]);

  const scan = useCallback(() => {
    // ── Defensive cleanup ──────────────────────────────────────
    // Evict dead/closing connections so their ports get re-probed.
    // This handles cases where onclose hasn't fired yet (TCP timeout).
    for (const [port, ws] of connectionsRef.current) {
      if (ws.readyState !== WebSocket.OPEN) {
        ws.close();
        connectionsRef.current.delete(port);
        lastPongRef.current.delete(port);
        removePlugin(port);
      }
    }
    // Clear stale probing entries from previous scan cycle
    probingRef.current.clear();

    // Cancel any in-progress staggered probes from previous scan
    for (const t of staggerTimersRef.current) clearTimeout(t);
    staggerTimersRef.current = [];

    setScanning(true);

    // Stagger probes: 5ms apart → ~100 ports over 500ms, max ~4-5 in-flight
    let delay = 0;
    for (let port = PORT_MIN; port <= PORT_MAX; port++) {
      const t = setTimeout(() => probePort(port), delay);
      staggerTimersRef.current.push(t);
      delay += STAGGER_MS;
    }

    // Scanning done after last probe + its timeout
    const totalMs = delay + CONNECT_TIMEOUT_MS + 100;
    const doneTimer = setTimeout(() => {
      setScanning(false);
      probeHttpForBlocking();
    }, totalMs);
    staggerTimersRef.current.push(doneTimer);
  }, [probePort, setScanning, removePlugin, probeHttpForBlocking]);

  useEffect(() => {
    // Initial scan on mount
    scan();

    // Periodic ping + dead-connection detection
    pingTimerRef.current = setInterval(() => {
      const now = Date.now();
      const pingJson = JSON.stringify({ type: "ping", ts: now });
      for (const [port, ws] of connectionsRef.current) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(pingJson);
          // If we haven't received a pong in PONG_TIMEOUT_MS, the connection is dead
          const lastPong = lastPongRef.current.get(port) ?? 0;
          if (lastPong > 0 && now - lastPong > PONG_TIMEOUT_MS) {
            ws.close(); // triggers onclose → cleanup → re-probe on next scan
          }
        }
      }
    }, PING_INTERVAL_MS);

    return () => {
      if (pingTimerRef.current) clearInterval(pingTimerRef.current);
      for (const t of staggerTimersRef.current) clearTimeout(t);
      staggerTimersRef.current = [];
      // Close all connections
      for (const ws of connectionsRef.current.values()) {
        ws.close();
      }
      connectionsRef.current.clear();
      probingRef.current.clear();
      lastPongRef.current.clear();
    };
  }, [scan]);

  const requestSnapshot = useCallback((port: number) => {
    const ws = connectionsRef.current.get(port);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "request:snapshot", ts: Date.now() }));
    }
  }, []);

  const send = useCallback((port: number, msg: ClientMessage) => {
    const ws = connectionsRef.current.get(port);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
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
