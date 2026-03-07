import { useContext, useEffect } from "react";
import { TouchBarContext } from "@/context/touchbar-context";
import { EventBusContext } from "@/context/providers";
import { useCallbackRef } from "./internal/useCallbackRef";
import type {
  TouchBarInfo,
  TouchBarTapPayload,
  TouchBarDialRotatePayload,
  TouchBarDialPressPayload,
} from "@/types";

// ── Internal helper ─────────────────────────────────────────────────

function useTouchBarEvent<T>(event: string, callback: (payload: T) => void): void {
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

// ── useTouchBar ─────────────────────────────────────────────────────
// Returns touchbar geometry: active columns, full width, segment width.

export function useTouchBar(): TouchBarInfo {
  return useContext(TouchBarContext);
}

// ── useTouchBarTap ──────────────────────────────────────────────────
// Receives touch events with absolute coordinates across the full strip.

export function useTouchBarTap(
  callback: (payload: TouchBarTapPayload) => void,
): void {
  useTouchBarEvent("touchBarTap", callback);
}

// ── useTouchBarDialRotate ───────────────────────────────────────────

export function useTouchBarDialRotate(
  callback: (payload: TouchBarDialRotatePayload) => void,
): void {
  useTouchBarEvent("touchBarDialRotate", callback);
}

// ── useTouchBarDialDown ─────────────────────────────────────────────

export function useTouchBarDialDown(
  callback: (payload: TouchBarDialPressPayload) => void,
): void {
  useTouchBarEvent("touchBarDialDown", callback);
}

// ── useTouchBarDialUp ───────────────────────────────────────────────

export function useTouchBarDialUp(
  callback: (payload: TouchBarDialPressPayload) => void,
): void {
  useTouchBarEvent("touchBarDialUp", callback);
}
