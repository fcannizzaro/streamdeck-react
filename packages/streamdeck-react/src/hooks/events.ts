import { useContext, useEffect } from "react";
import { EventBusContext } from "@/context/providers";
import type {
  KeyDownPayload,
  KeyUpPayload,
  DialRotatePayload,
  DialPressPayload,
  TouchTapPayload,
  DialHints,
} from "@/types";
import { StreamDeckContext } from "@/context/providers";
import { useCallbackRef } from "./internal/useCallbackRef";

// ── Hardware Event Hooks ────────────────────────────────────────────
//
// Thin wrappers around the EventBus that subscribe to Stream Deck
// hardware events.  All hooks use the same internal pattern:
//
//   useEvent(eventName, callback)
//     1. Get EventBus from context
//     2. Wrap callback in useCallbackRef (prevents stale closures)
//     3. useEffect: bus.on(event, handler) + cleanup bus.off()
//
// The useCallbackRef pattern is critical here:
//   Without it, every re-render with a new callback function would
//   cause useEffect to re-run (unsubscribe + resubscribe).  With
//   useCallbackRef, the ref is updated on every render but the
//   effect only runs once (stable ref identity in deps).

// ── Internal hook pattern: subscribe to event bus ───────────────────

function useEvent<T>(event: string, callback: (payload: T) => void): void {
  const bus = useContext(EventBusContext);
  const callbackRef = useCallbackRef(callback);

  useEffect(() => {
    const handler = (payload: T) => {
      callbackRef.current(payload);
    };
    bus.on(event as never, handler as never);
    return () => bus.off(event as never, handler as never);
  }, [bus, callbackRef, event]);
}

// ── Key Events ──────────────────────────────────────────────────────

export function useKeyDown(callback: (payload: KeyDownPayload) => void): void {
  useEvent("keyDown", callback);
}

export function useKeyUp(callback: (payload: KeyUpPayload) => void): void {
  useEvent("keyUp", callback);
}

// ── Dial / Encoder Events ───────────────────────────────────────────

export function useDialRotate(callback: (payload: DialRotatePayload) => void): void {
  useEvent("dialRotate", callback);
}

export function useDialDown(callback: (payload: DialPressPayload) => void): void {
  useEvent("dialDown", callback);
}

export function useDialUp(callback: (payload: DialPressPayload) => void): void {
  useEvent("dialUp", callback);
}

// ── Touch Events ────────────────────────────────────────────────────

export function useTouchTap(callback: (payload: TouchTapPayload) => void): void {
  useEvent("touchTap", callback);
}

// ── Dial Hints ──────────────────────────────────────────────────────

export function useDialHint(hints: DialHints): void {
  const { action } = useContext(StreamDeckContext);

  // The adapter action handle always has setTriggerDescription() — it
  // no-ops internally for non-encoder surfaces.
  useEffect(() => {
    action.setTriggerDescription({
      rotate: hints.rotate,
      push: hints.press,
      touch: hints.touch,
      longTouch: hints.longTouch,
    });
  }, [action, hints.rotate, hints.press, hints.touch, hints.longTouch]);
}
