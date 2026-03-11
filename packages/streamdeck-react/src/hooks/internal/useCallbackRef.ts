import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";

// ── useCallbackRef ──────────────────────────────────────────────────
//
// Prevents stale closure captures in event handlers without adding the
// callback to useEffect dependency arrays.
//
// Problem: event hooks (useKeyDown, useTap, etc.) subscribe to the
// EventBus via useEffect.  If the user's callback closes over state,
// a new function is created every render.  Putting the callback in
// useEffect deps would cause unsubscribe+resubscribe churn on every
// render — O(n) per render for n subscriptions.
//
// Solution: store the latest callback in a ref.  The ref identity is
// stable (same object across renders), so useEffect deps don't change.
// The ref's .current is updated after each render via a layout-phase
// useEffect, ensuring the handler always calls the latest closure.

export function useCallbackRef<T>(callback: T): MutableRefObject<T> {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  });

  return callbackRef;
}
