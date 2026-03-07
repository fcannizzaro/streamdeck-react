import { useContext, useEffect, useRef } from "react";
import { EventBusContext } from "@/context/providers.ts";
import type {
  KeyDownPayload,
  KeyUpPayload,
  DialRotatePayload,
  DialPressPayload,
  TouchTapPayload,
  DialHints,
} from "@/types.ts";
import { StreamDeckContext } from "@/context/providers.ts";
import type { DialAction } from "@elgato/streamdeck";
import { useCallbackRef } from "./internal/useCallbackRef.ts";

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

export function useDialRotate(
  callback: (payload: DialRotatePayload) => void,
): void {
  useEvent("dialRotate", callback);
}

export function useDialDown(
  callback: (payload: DialPressPayload) => void,
): void {
  useEvent("dialDown", callback);
}

export function useDialUp(
  callback: (payload: DialPressPayload) => void,
): void {
  useEvent("dialUp", callback);
}

// ── Touch Events ────────────────────────────────────────────────────

export function useTouchTap(
  callback: (payload: TouchTapPayload) => void,
): void {
  useEvent("touchTap", callback);
}

// ── Dial Hints ──────────────────────────────────────────────────────

export function useDialHint(hints: DialHints): void {
  const { action } = useContext(StreamDeckContext);
  const prevHints = useRef<string>("");

  useEffect(() => {
    const serialized = JSON.stringify(hints);
    if (serialized === prevHints.current) return;
    prevHints.current = serialized;

    if ("setTriggerDescription" in action) {
      (action as DialAction).setTriggerDescription({
        rotate: hints.rotate,
        push: hints.press,
        touch: hints.touch,
        longTouch: hints.longTouch,
      });
    }
  }, [action, hints.rotate, hints.press, hints.touch, hints.longTouch]);
}
