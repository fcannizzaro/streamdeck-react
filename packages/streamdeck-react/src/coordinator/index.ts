// ── Action Coordinator ───────────────────────────────────────────────
//
// Plugin-level singleton that enables cross-action communication
// without requiring external state managers (Zustand, Jotai).
//
// Two capabilities:
//
//   1. Presence Tracking
//      Maintains a live map of which action instances are currently
//      visible on the Stream Deck, including their surface type,
//      coordinates, and device.  Updated automatically by the
//      RootRegistry on willAppear/willDisappear.
//
//   2. Channel State Bus
//      Named publish/subscribe channels with latest-value semantics.
//      Any action can publish to a channel; all subscribers receive
//      the value.  New subscribers to a channel that already has a
//      value receive it immediately (like sticky events).
//
// Architecture:
//
//   createPlugin({ coordinator: true })
//     │
//     └─ ActionCoordinator (singleton)
//          │
//          ├─ Presence Map
//          │    Map<actionId, ActionPresenceInfo>
//          │    Mutated by registry lifecycle callbacks.
//          │    Subscribers notified via listener pattern.
//          │
//          └─ Channel Map
//               Map<channelName, ChannelState<T>>
//               Each channel holds a current value and a Set of
//               subscriber callbacks.  Updates trigger only the
//               subscribers of the changed channel (no global
//               re-render).
//
// React integration:
//   Hooks use useSyncExternalStore to subscribe to specific channels
//   or presence changes.  This ensures:
//     - Concurrent-mode safe subscriptions
//     - Scoped re-renders (only subscribers of changed data re-render)
//     - Automatic cleanup on unmount
//
// Memory:
//   Channels persist for the plugin lifetime.  Values are typically
//   small (booleans, strings, numbers), so memory is negligible.
//   Presence entries are cleaned up automatically on willDisappear.

// ── Types ───────────────────────────────────────────────────────────

/** Information about a currently visible action instance. */
export interface ActionPresenceInfo {
  /** Unique action instance ID (contextId). */
  id: string;
  /** Action definition UUID (e.g., "com.example.plugin.volume"). */
  uuid: string;
  /** Surface type this instance is rendered on. */
  surface: "key" | "dial" | "touch";
  /** Grid coordinates on the device (undefined for touch strip). */
  coordinates?: { column: number; row: number };
  /** Device ID this instance belongs to. */
  deviceId: string;
}

/** Snapshot of all presence data, returned by useActionPresence. */
export interface ActionPresenceSnapshot {
  /** All currently visible action instances. */
  readonly all: readonly ActionPresenceInfo[];
  /** Filter instances by action UUID. */
  byUuid(uuid: string): readonly ActionPresenceInfo[];
  /** Total count of visible action instances. */
  readonly count: number;
}

type Listener = () => void;

// ── Internal Channel State ──────────────────────────────────────────

interface ChannelState<T = unknown> {
  value: T;
  listeners: Set<Listener>;
}

// ── Action Coordinator ──────────────────────────────────────────────

export class ActionCoordinator {
  // ── Presence Tracking ───────────────────────────────────────────
  private presenceMap = new Map<string, ActionPresenceInfo>();
  private presenceListeners = new Set<Listener>();
  private presenceVersion = 0;

  // ── Channel State Bus ─────────────────────────────────────────
  private channels = new Map<string, ChannelState>();

  // ── Presence: External Store API ──────────────────────────────
  //
  // These methods form the useSyncExternalStore contract for
  // presence subscriptions.  The version counter ensures React
  // detects changes without deep-comparing the presence map.

  /** Subscribe to presence changes. Returns unsubscribe function. */
  subscribePresence = (listener: Listener): (() => void) => {
    this.presenceListeners.add(listener);
    return () => {
      this.presenceListeners.delete(listener);
    };
  };

  /** Get a snapshot of current presence data. */
  getPresenceSnapshot = (): ActionPresenceSnapshot => {
    // Memoize snapshot per version to avoid allocating new arrays
    // on every useSyncExternalStore check.
    if (this._cachedPresenceVersion !== this.presenceVersion) {
      this._cachedPresenceVersion = this.presenceVersion;
      const all = [...this.presenceMap.values()];
      this._cachedPresenceSnapshot = {
        all,
        byUuid: (uuid: string) => all.filter((p) => p.uuid === uuid),
        count: all.length,
      };
    }
    return this._cachedPresenceSnapshot!;
  };

  private _cachedPresenceVersion = -1;
  private _cachedPresenceSnapshot: ActionPresenceSnapshot | null = null;

  private notifyPresenceListeners(): void {
    this.presenceVersion++;
    for (const listener of this.presenceListeners) {
      try {
        listener();
      } catch (err) {
        console.error("[@fcannizzaro/streamdeck-react] Error in presence listener:", err);
      }
    }
  }

  // ── Presence: Lifecycle Methods ───────────────────────────────
  // Called by the RootRegistry on willAppear/willDisappear.
  // Not part of the public hook API — these are internal.

  /** @internal Register an action instance as visible. */
  registerAction(info: ActionPresenceInfo): void {
    this.presenceMap.set(info.id, info);
    this.notifyPresenceListeners();
  }

  /** @internal Remove an action instance (no longer visible). */
  unregisterAction(actionId: string): void {
    if (this.presenceMap.delete(actionId)) {
      this.notifyPresenceListeners();
    }
  }

  // ── Channel: External Store API ───────────────────────────────
  //
  // Each channel is an independent external store.  Hooks subscribe
  // to a specific channel by name.  Updating one channel only
  // triggers re-renders in components subscribed to that channel.

  /**
   * Subscribe to a specific channel. Returns unsubscribe function.
   * If the channel doesn't exist yet, it is created lazily.
   */
  subscribeChannel(channelName: string, listener: Listener): () => void {
    const channel = this.getOrCreateChannel(channelName);
    channel.listeners.add(listener);
    return () => {
      channel.listeners.delete(listener);
    };
  }

  /**
   * Get the current value of a channel.
   * Returns undefined if the channel hasn't been written to.
   */
  getChannelValue<T>(channelName: string): T | undefined {
    const channel = this.channels.get(channelName);
    return channel?.value as T | undefined;
  }

  /**
   * Set the value of a channel. Notifies all subscribers.
   * Creates the channel if it doesn't exist yet.
   */
  setChannelValue<T>(channelName: string, value: T): void {
    const channel = this.getOrCreateChannel(channelName);
    // Skip notification if value is referentially identical
    if (channel.value === value) return;
    channel.value = value;
    for (const listener of channel.listeners) {
      try {
        listener();
      } catch (err) {
        console.error(
          `[@fcannizzaro/streamdeck-react] Error in channel "${channelName}" listener:`,
          err,
        );
      }
    }
  }

  private getOrCreateChannel(name: string): ChannelState {
    let channel = this.channels.get(name);
    if (!channel) {
      channel = { value: undefined, listeners: new Set() };
      this.channels.set(name, channel);
    }
    return channel;
  }

  // ── Cleanup ───────────────────────────────────────────────────

  /** @internal Clear all state. Used for testing. */
  reset(): void {
    this.presenceMap.clear();
    this.presenceListeners.clear();
    this.presenceVersion = 0;
    this._cachedPresenceVersion = -1;
    this._cachedPresenceSnapshot = null;
    this.channels.clear();
  }
}
