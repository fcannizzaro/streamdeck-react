import { useContext, useEffect } from "react";
import { TouchStripContext } from "@/context/touchstrip-context";
import { EventBusContext } from "@/context/providers";
import { useCallbackRef } from "./internal/useCallbackRef";
import type {
  TouchStripInfo,
  TouchStripTapPayload,
  TouchStripDialRotatePayload,
  TouchStripDialPressPayload,
} from "@/types";

// ── Internal helper ─────────────────────────────────────────────────

function useTouchStripEvent<T>(event: string, callback: (payload: T) => void): void {
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

// ── useTouchStrip ─────────────────────────────────────────────────────
// Returns TouchStrip geometry: active columns, full width, segment width.

export function useTouchStrip(): TouchStripInfo {
  return useContext(TouchStripContext);
}

// ── useTouchStripTap ──────────────────────────────────────────────────
// Receives touch events with absolute coordinates across the full strip.

export function useTouchStripTap(callback: (payload: TouchStripTapPayload) => void): void {
  useTouchStripEvent("touchStripTap", callback);
}

// ── useTouchStripDialRotate ───────────────────────────────────────────

export function useTouchStripDialRotate(
  callback: (payload: TouchStripDialRotatePayload) => void,
): void {
  useTouchStripEvent("touchStripDialRotate", callback);
}

// ── useTouchStripDialDown ─────────────────────────────────────────────

export function useTouchStripDialDown(
  callback: (payload: TouchStripDialPressPayload) => void,
): void {
  useTouchStripEvent("touchStripDialDown", callback);
}

// ── useTouchStripDialUp ───────────────────────────────────────────────

export function useTouchStripDialUp(callback: (payload: TouchStripDialPressPayload) => void): void {
  useTouchStripEvent("touchStripDialUp", callback);
}
