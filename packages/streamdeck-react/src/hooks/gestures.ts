import { useContext, useEffect, useRef } from "react";
import { EventBusContext } from "@/context/providers";
import { useCallbackRef } from "./internal/useCallbackRef";
import type { EventBus } from "@/context/event-bus";
import type { KeyDownPayload, KeyUpPayload } from "@/types";

// ── Gesture Recognition Hooks ───────────────────────────────────────
//
// Three gesture hooks that compose together automatically:
//
//   useTap        — single keyUp event
//   useLongPress  — keyDown held for N ms (keyUp cancels timer)
//   useDoubleTap  — two keyUp events within N ms
//
// Tap / DoubleTap interaction (TapGate):
//
//   When useTap and useDoubleTap are both active on the same action,
//   they need implicit coordination — a single tap must be delayed
//   until the double-tap window expires, and cancelled if a second
//   tap arrives:
//
//     keyUp #1                   keyUp #2 (within timeout)
//       │                          │
//       ▼                          ▼
//     TapGate.schedule()         useDoubleTap detects pair
//       │                          │
//       │ timeout fires            │ TapGate.cancel()
//       ▼                          ▼
//     useTap callback            useDoubleTap callback
//     (delayed by timeout)       (immediate, cancels pending tap)
//
//   If only useTap is used (no useDoubleTap), the gate timeout is 0
//   and taps fire immediately with no delay.
//
//   The TapGate is scoped per-action using a WeakMap keyed on the
//   EventBus instance.  This avoids adding another React context
//   and automatically garbage-collects when the action is destroyed.

// ── Options ─────────────────────────────────────────────────────────

export interface TapOptions {
  /** Timeout override for the gated delay (inherits from useDoubleTap when omitted). */
  timeout?: number;
}

export interface LongPressOptions {
  /** Milliseconds the key must be held before firing. @default 500 */
  timeout?: number;
}

export interface DoubleTapOptions {
  /** Max milliseconds between two key-up events. @default 250 */
  timeout?: number;
}

// ── Defaults ────────────────────────────────────────────────────────

const DEFAULT_LONG_PRESS_TIMEOUT = 500;
const DEFAULT_DOUBLE_TAP_TIMEOUT = 250;

// ── TapGate — implicit coordination between useTap & useDoubleTap ──
// Each action has its own EventBus, so keying on the bus gives us
// per-action scoping without an additional React context.
//
// When useDoubleTap mounts, it registers its timeout on the gate.
// useTap checks the gate's timeout on each keyUp — if >0, it delays
// the callback via gate.schedule().  useDoubleTap can then cancel()
// the pending tap if a double-tap is detected.

class TapGate {
  /** Double-tap timeout in ms. 0 means no gate (useTap fires immediately). */
  timeout = 0;

  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingCallback: ((p: KeyUpPayload) => void) | null = null;
  private pendingPayload: KeyUpPayload | null = null;

  /** Called by useDoubleTap on mount. */
  register(timeout: number): void {
    this.timeout = timeout;
  }

  /** Called by useDoubleTap on unmount. */
  unregister(): void {
    this.timeout = 0;
    this.cancel();
  }

  /** Called by useTap to schedule a delayed single-tap. */
  schedule(callback: (p: KeyUpPayload) => void, payload: KeyUpPayload, timeout: number): void {
    this.cancel();
    this.pendingCallback = callback;
    this.pendingPayload = payload;
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null;
      this.pendingCallback?.(this.pendingPayload!);
      this.pendingCallback = null;
      this.pendingPayload = null;
    }, timeout);
  }

  /** Called by useDoubleTap when a double-tap is detected, and on cleanup. */
  cancel(): void {
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    this.pendingCallback = null;
    this.pendingPayload = null;
  }
}

const gates = new WeakMap<EventBus, TapGate>();

function getGate(bus: EventBus): TapGate {
  let gate = gates.get(bus);
  if (!gate) {
    gate = new TapGate();
    gates.set(bus, gate);
  }
  return gate;
}

// ── useTap ──────────────────────────────────────────────────────────
// Fires on a single keyUp. When useDoubleTap is also active for the
// same action, the callback is automatically delayed until the
// double-tap window expires (and cancelled if a double-tap fires).

export function useTap(callback: (payload: KeyUpPayload) => void, options?: TapOptions): void {
  const bus = useContext(EventBusContext);
  const callbackRef = useCallbackRef(callback);
  const overrideTimeout = options?.timeout;

  useEffect(() => {
    const gate = getGate(bus);

    const onKeyUp = (payload: KeyUpPayload) => {
      const gateTimeout = overrideTimeout ?? gate.timeout;

      if (gateTimeout > 0) {
        gate.schedule((p) => callbackRef.current(p), payload, gateTimeout);
      } else {
        callbackRef.current(payload);
      }
    };

    bus.on("keyUp", onKeyUp);

    return () => {
      bus.off("keyUp", onKeyUp);
      gate.cancel();
    };
  }, [bus, callbackRef, overrideTimeout]);
}

// ── useLongPress ────────────────────────────────────────────────────
// Fires when a key is held down for at least `timeout` ms.
// If the key is released before the timeout, the callback is not invoked.

export function useLongPress(
  callback: (payload: KeyDownPayload) => void,
  options?: LongPressOptions,
): void {
  const bus = useContext(EventBusContext);
  const callbackRef = useCallbackRef(callback);
  const timeout = options?.timeout ?? DEFAULT_LONG_PRESS_TIMEOUT;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const payloadRef = useRef<KeyDownPayload | null>(null);

  useEffect(() => {
    const clear = () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      payloadRef.current = null;
    };

    const onKeyDown = (payload: KeyDownPayload) => {
      clear();
      payloadRef.current = payload;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        callbackRef.current(payloadRef.current!);
      }, timeout);
    };

    const onKeyUp = () => {
      clear();
    };

    bus.on("keyDown", onKeyDown);
    bus.on("keyUp", onKeyUp);

    return () => {
      clear();
      bus.off("keyDown", onKeyDown);
      bus.off("keyUp", onKeyUp);
    };
  }, [bus, callbackRef, timeout]);
}

// ── useDoubleTap ────────────────────────────────────────────────────
// Fires when two keyUp events occur within `timeout` ms of each other.
// A triple-tap triggers once on the second tap; the third tap starts a
// new pair.
//
// When useTap is also active, useDoubleTap registers a gate so that
// single-tap callbacks are delayed and can be cancelled on double-tap.

export function useDoubleTap(
  callback: (payload: KeyUpPayload) => void,
  options?: DoubleTapOptions,
): void {
  const bus = useContext(EventBusContext);
  const callbackRef = useCallbackRef(callback);
  const timeout = options?.timeout ?? DEFAULT_DOUBLE_TAP_TIMEOUT;

  const lastTimeRef = useRef(0);

  useEffect(() => {
    const gate = getGate(bus);
    gate.register(timeout);

    const onKeyUp = (payload: KeyUpPayload) => {
      const now = Date.now();

      if (lastTimeRef.current !== 0 && now - lastTimeRef.current <= timeout) {
        // Double-tap detected — cancel any pending single-tap and fire
        gate.cancel();
        callbackRef.current(payload);
        lastTimeRef.current = 0;
      } else {
        lastTimeRef.current = now;
      }
    };

    bus.on("keyUp", onKeyUp);

    return () => {
      bus.off("keyUp", onKeyUp);
      gate.unregister();
      lastTimeRef.current = 0;
    };
  }, [bus, callbackRef, timeout]);
}
