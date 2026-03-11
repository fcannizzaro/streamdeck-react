import { useContext, useEffect } from "react";
import { EventBusContext } from "@/context/providers";
import type { WillAppearPayload } from "@/types";
import { useCallbackRef } from "./internal/useCallbackRef";

// ── Lifecycle Hooks ─────────────────────────────────────────────────
//
// willAppear is emitted as a STICKY event — if the component mounts
// after the event has already fired (e.g. lazy loading, conditional
// rendering), the callback receives the stored payload immediately.
//
// willDisappear fires when the root is about to unmount (the action
// is being removed from the Stream Deck layout).  This is the
// Stream Deck equivalent of useEffect cleanup.

// ── useWillAppear ───────────────────────────────────────────────────
// Fires once when the action instance appears and the root is mounted.

export function useWillAppear(callback: (payload: WillAppearPayload) => void): void {
  const bus = useContext(EventBusContext);
  const callbackRef = useCallbackRef(callback);

  useEffect(() => {
    const handler = (payload: WillAppearPayload) => {
      callbackRef.current(payload);
    };
    bus.on("willAppear", handler);
    return () => bus.off("willAppear", handler);
  }, [bus, callbackRef]);
}

// ── useWillDisappear ────────────────────────────────────────────────
// Fires when the action is about to disappear (root unmounting).
// This is essentially useEffect cleanup tied to the Stream Deck lifecycle.

export function useWillDisappear(callback: () => void): void {
  const bus = useContext(EventBusContext);
  const callbackRef = useCallbackRef(callback);

  useEffect(() => {
    const handler = () => {
      callbackRef.current();
    };
    bus.on("willDisappear", handler as never);
    return () => bus.off("willDisappear", handler as never);
  }, [bus, callbackRef]);
}
