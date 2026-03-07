import type { EventMap } from "@/types";

// ── Typed Event Bus ─────────────────────────────────────────────────

type Listener<T> = (payload: T) => void;

export class EventBus {
  private listeners = new Map<string, Set<Listener<unknown>>>();
  private sticky = new Map<string, unknown>();

  on<K extends keyof EventMap>(
    event: K,
    listener: Listener<EventMap[K]>,
  ): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener as Listener<unknown>);

    if (this.sticky.has(event)) {
      this.callListener(event, listener as Listener<unknown>, this.sticky.get(event));
    }
  }

  off<K extends keyof EventMap>(
    event: K,
    listener: Listener<EventMap[K]>,
  ): void {
    this.listeners.get(event)?.delete(listener as Listener<unknown>);
  }

  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
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

  private callListener(
    event: string,
    listener: Listener<unknown>,
    payload: unknown,
  ): void {
    try {
      listener(payload);
    } catch (err) {
      console.error(
        `[@fcannizzaro/streamdeck-react] Error in event handler for "${event}":`,
        err,
      );
    }
  }
}
