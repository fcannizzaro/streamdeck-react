import { useCallback, useEffect, useMemo, useRef } from "react";
import { useCallbackRef } from "./internal/useCallbackRef";

// ── Timer & Utility Hooks ───────────────────────────────────────────
//
// setInterval/setTimeout-based timing hooks.  Stream Deck plugins run
// in a headless Node.js environment — there is no requestAnimationFrame.
// All animation and periodic tasks use setInterval-driven tick loops.
//
// useTick is the core animation driver:
//   - Calculates delta time between ticks
//   - Accepts FPS target or `false` to pause
//   - Used by useSpring and useTween for frame stepping
//   - Also available to users for custom animation logic

const DEFAULT_TICK_FPS = 30;
const MAX_TICK_FPS = 30;

export type IntervalControls = {
  reset: () => void;
};

export type TimeoutControls = {
  cancel: () => void;
  reset: () => void;
};

function toTickIntervalMs(fps: number): number {
  if (!Number.isFinite(fps) || fps <= 0) {
    return Math.round(1000 / DEFAULT_TICK_FPS);
  }

  return Math.max(1, Math.round(1000 / Math.min(fps, MAX_TICK_FPS)));
}

// ── useInterval ─────────────────────────────────────────────────────
// Safe interval hook. Auto-cleans on unmount. Pass null to pause.

export function useInterval(callback: () => void, delayMs: number | null): IntervalControls {
  const callbackRef = useCallbackRef(callback);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clear = useCallback(() => {
    if (intervalRef.current === null) return;

    clearInterval(intervalRef.current);
    intervalRef.current = null;
  }, []);

  const start = useCallback(() => {
    if (delayMs === null) {
      clear();
      return;
    }

    clear();
    intervalRef.current = setInterval(() => {
      callbackRef.current();
    }, delayMs);
  }, [callbackRef, clear, delayMs]);

  useEffect(() => {
    start();
    return clear;
  }, [clear, start]);

  const reset = useCallback(() => {
    start();
  }, [start]);

  return useMemo(
    () => ({
      reset,
    }),
    [reset],
  );
}

// ── useTimeout ──────────────────────────────────────────────────────
// Safe timeout hook. Auto-cleans on unmount. Pass null to cancel.

export function useTimeout(callback: () => void, delayMs: number | null): TimeoutControls {
  const callbackRef = useCallbackRef(callback);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timeoutRef.current === null) return;

    clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }, []);

  const start = useCallback(() => {
    if (delayMs === null) {
      clear();
      return;
    }

    clear();
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      callbackRef.current();
    }, delayMs);
  }, [callbackRef, clear, delayMs]);

  useEffect(() => {
    start();
    return clear;
  }, [clear, start]);

  const cancel = useCallback(() => {
    clear();
  }, [clear]);

  const reset = useCallback(() => {
    start();
  }, [start]);

  return useMemo(
    () => ({
      cancel,
      reset,
    }),
    [cancel, reset],
  );
}

// ── usePrevious ─────────────────────────────────────────────────────

export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined);
  const current = ref.current;

  useEffect(() => {
    ref.current = value;
  });

  return current;
}

// ── useTick ──────────────────────────────────────────────────────────
// Calls the callback repeatedly with delta time (ms since last tick).
// Built on useInterval — pass a number to set target FPS, or false to
// pause.  The tick loop automatically starts/stops when the parameter
// changes, enabling patterns like:
//
//   useTick(onFrame, isAnimating ? 30 : false);
//
// Delta time is computed from Date.now() difference (not interval timing)
// to account for timer drift and GC pauses.
//
// FPS values above 30 are clamped because Stream Deck hardware does not
// display updates faster than 30Hz, so higher tick rates only create extra
// React/state churn with no visible benefit on-device.

export function useTick(
  callback: (deltaMs: number) => void,
  fpsOrActive: number | boolean = DEFAULT_TICK_FPS,
): void {
  const callbackRef = useCallbackRef(callback);
  const lastTime = useRef(Date.now());
  const active = fpsOrActive !== false;
  const fps = typeof fpsOrActive === "number" ? fpsOrActive : DEFAULT_TICK_FPS;
  const delayMs = active ? toTickIntervalMs(fps) : null;

  useEffect(() => {
    lastTime.current = Date.now();
  }, [active, delayMs]);

  useInterval(() => {
    const now = Date.now();
    const delta = now - lastTime.current;
    lastTime.current = now;
    callbackRef.current(delta);
  }, delayMs);
}
