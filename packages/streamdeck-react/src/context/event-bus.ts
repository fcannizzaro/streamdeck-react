import type { EventMap } from "@/types";

// ── Typed Event Bus ─────────────────────────────────────────────────
//
// Per-root event bus for routing Stream Deck hardware events to React
// hooks.  Each ReactRoot and TouchStripRoot gets its own EventBus
// instance, providing isolation between action instances.
//
// Key features:
//
//   Typed events:
//     Event names and payloads are constrained by the EventMap type,
//     preventing typos and payload mismatches at compile time.
//
//   Sticky events:
//     emitSticky() stores the payload.  When a listener subscribes
//     to a sticky event that has already fired, it receives the stored
//     payload immediately.  Used for willAppear — components that mount
//     after the event still get the initial payload.
//
//   DevTools observer:
//     A static class-level hook (devtoolsObserver) intercepts all
//     emit() calls across all EventBus instances.  This single entry
//     point feeds the devtools bridge without modifying individual
//     bus instances.  Set to null when devtools is off.
//
//   Error isolation:
//     Each listener is called in a try/catch.  A crash in one event
//     handler doesn't prevent other handlers from running.

type Listener<T> = (payload: T) => void;

export class EventBus {
  private listeners = new Map<string, Set<Listener<unknown>>>();
  private sticky = new Map<string, unknown>();

  /** Global devtools observer. Set by DevtoolsBridge when devtools mode is on. */
  static devtoolsObserver: ((bus: EventBus, event: string, payload: unknown) => void) | null = null;

  /** Owning action ID. Set by ReactRoot/TouchStripRoot on creation. Used by devtools. */
  ownerId: string | null = null;
  /** Owning action UUID. Set by ReactRoot on creation. Used by devtools. */
  ownerUuid: string | null = null;

  on<K extends keyof EventMap>(event: K, listener: Listener<EventMap[K]>): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener as Listener<unknown>);

    if (this.sticky.has(event)) {
      this.callListener(event, listener as Listener<unknown>, this.sticky.get(event));
    }
  }

  off<K extends keyof EventMap>(event: K, listener: Listener<EventMap[K]>): void {
    this.listeners.get(event)?.delete(listener as Listener<unknown>);
  }

  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    EventBus.devtoolsObserver?.(this, event, payload);
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        this.callListener(event, handler, payload);
      }
    }
  }

  emitSticky<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    this.sticky.set(event, payload);
    this.emit(event, payload);
  }

  removeAllListeners(): void {
    this.listeners.clear();
    this.sticky.clear();
  }

  private callListener(event: string, listener: Listener<unknown>, payload: unknown): void {
    try {
      listener(payload);
    } catch (err) {
      console.error(`[@fcannizzaro/streamdeck-react] Error in event handler for "${event}":`, err);
    }
  }
}
