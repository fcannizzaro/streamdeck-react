import { useContext, useEffect } from "react";
import { EventBusContext } from "@/context/providers.ts";
import type { WillAppearPayload } from "@/types.ts";
import { useCallbackRef } from "./internal/useCallbackRef.ts";

// ── useWillAppear ───────────────────────────────────────────────────
// Fires once when the action instance appears and the root is mounted.

export function useWillAppear(
  callback: (payload: WillAppearPayload) => void,
): void {
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
