import { useContext, useCallback, useSyncExternalStore } from "react";
import { CoordinatorContext } from "@/context/providers";
import type { ActionCoordinator, ActionPresenceSnapshot } from "@/coordinator/index";

// ── Coordinator Hooks ───────────────────────────────────────────────
//
// React hooks for the Action Coordinator subsystem.  All hooks use
// useSyncExternalStore for concurrent-mode-safe subscriptions with
// scoped re-renders.
//
// Three hooks:
//
//   useCoordinator()          — raw coordinator instance (escape hatch)
//   useChannel<T>(name, def)  — named channel read/write
//   useActionPresence()       — live presence snapshot
//
// All hooks throw if called without a coordinator context (i.e.,
// createPlugin was called without `coordinator: true`).

// ── Internal: Get coordinator or throw ──────────────────────────────

function useCoordinatorOrThrow(): ActionCoordinator {
  const coordinator = useContext(CoordinatorContext);
  if (coordinator == null) {
    throw new Error(
      "[@fcannizzaro/streamdeck-react] useCoordinator/useChannel/useActionPresence requires `coordinator: true` in createPlugin()",
    );
  }
  return coordinator;
}

// ── useCoordinator ──────────────────────────────────────────────────
//
// Escape hatch — returns the raw ActionCoordinator instance.
// Useful for imperative operations (e.g., setting a channel from
// an event handler without subscribing to it).

/**
 * Returns the ActionCoordinator instance.
 *
 * @throws If `coordinator: true` was not set in createPlugin().
 *
 * @example
 * ```ts
 * const coordinator = useCoordinator();
 * coordinator.setChannelValue("playback", "paused");
 * ```
 */
export function useCoordinator(): ActionCoordinator {
  return useCoordinatorOrThrow();
}

// ── useChannel ──────────────────────────────────────────────────────
//
// Named channel with read/write access.  Subscribes to a specific
// channel and re-renders only when that channel's value changes.
//
// Uses useSyncExternalStore for concurrent-mode safety.  The subscribe
// function is stable (useCallback with channel name dep), and the
// getSnapshot returns the channel's current value.
//
// The setter is also stable — it calls coordinator.setChannelValue
// which notifies all subscribers of the same channel.

/**
 * Subscribe to a named channel for cross-action state sharing.
 *
 * @param name - Channel name (any string, e.g., "playback", "volume").
 * @param defaultValue - Initial value if the channel hasn't been set.
 * @returns `[value, setValue]` tuple — like useState but shared across actions.
 *
 * @throws If `coordinator: true` was not set in createPlugin().
 *
 * @example
 * ```tsx
 * // In a "play/pause" action:
 * const [state, setState] = useChannel<"playing" | "paused">("playback", "paused");
 * useKeyDown(() => setState(state === "playing" ? "paused" : "playing"));
 *
 * // In a "now playing" action (reads the same channel):
 * const [state] = useChannel<"playing" | "paused">("playback", "paused");
 * ```
 */
export function useChannel<T>(name: string, defaultValue: T): [T, (value: T) => void] {
  const coordinator = useCoordinatorOrThrow();

  // Subscribe to the specific channel
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      return coordinator.subscribeChannel(name, onStoreChange);
    },
    [coordinator, name],
  );

  // Get the current channel value (or default)
  const getSnapshot = useCallback(() => {
    const value = coordinator.getChannelValue<T>(name);
    return value !== undefined ? value : defaultValue;
  }, [coordinator, name, defaultValue]);

  const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // Stable setter
  const setValue = useCallback(
    (newValue: T) => {
      coordinator.setChannelValue(name, newValue);
    },
    [coordinator, name],
  );

  return [value, setValue];
}

// ── useActionPresence ───────────────────────────────────────────────
//
// Live snapshot of which action instances are currently visible on
// the Stream Deck.  Re-renders only when the presence set changes
// (action appears or disappears).

/**
 * Returns a live snapshot of all currently visible action instances.
 *
 * @throws If `coordinator: true` was not set in createPlugin().
 *
 * @example
 * ```tsx
 * const presence = useActionPresence();
 * const volumeActions = presence.byUuid("com.example.plugin.volume");
 * const totalVisible = presence.count;
 * ```
 */
export function useActionPresence(): ActionPresenceSnapshot {
  const coordinator = useCoordinatorOrThrow();

  return useSyncExternalStore(
    coordinator.subscribePresence,
    coordinator.getPresenceSnapshot,
    coordinator.getPresenceSnapshot,
  );
}
