import { useCallback, useEffect, useMemo, useRef } from "react";
import { useCallbackRef } from "./internal/useCallbackRef.ts";

const DEFAULT_TICK_FPS = 60;

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

  return Math.max(1, Math.round(1000 / fps));
}

// ── useInterval ─────────────────────────────────────────────────────
// Safe interval hook. Auto-cleans on unmount. Pass null to pause.

export function useInterval(
  callback: () => void,
  delayMs: number | null,
): IntervalControls {
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

export function useTimeout(
  callback: () => void,
  delayMs: number | null,
): TimeoutControls {
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
// Calls the callback repeatedly with delta time using timer-driven ticks.
// Pass a number to set target FPS, or false to pause.

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

// ── useAnimationFrame ───────────────────────────────────────────────
// Deprecated wrapper for compatibility. This uses timer ticks, not
// browser requestAnimationFrame.

/**
 * @deprecated Use `useTick` instead.
 */
export function useAnimationFrame(
  callback: (deltaMs: number) => void,
  active = true,
): void {
  useTick(callback, active ? DEFAULT_TICK_FPS : false);
}
