import { useContext } from "react";
import { RootContext, DeviceContext } from "@/context/providers";
import type { ActionInfo, CanvasInfo, DeviceInfo, StreamDeckAccess } from "@/types";

// ── Context Hooks ───────────────────────────────────────────────────
//
// useAction, useCanvas, useStreamDeck read from the merged RootContext
// which is set once at root creation and never changes.
//
// useDevice reads from RootContext when available (ReactRoot), but
// falls back to the standalone DeviceContext (TouchStripRoot, which
// doesn't have per-action RootContext values).  Both are stable.
//
// Note: EventBus is NOT part of RootContext — it has its own
// EventBusContext since it's shared by both ReactRoot and
// TouchStripRoot.  Event hooks use EventBusContext directly.

// ── useDevice ───────────────────────────────────────────────────────
//
// Works in both ReactRoot (via merged RootContext) and TouchStripRoot
// (via standalone DeviceContext).  RootContext is tried first; if null
// (i.e. inside a TouchStripRoot), falls back to DeviceContext.

export function useDevice(): DeviceInfo {
  const rootCtx = useContext(RootContext);
  if (rootCtx != null) return rootCtx.device;
  return useContext(DeviceContext);
}

// ── useAction ───────────────────────────────────────────────────────

export function useAction(): ActionInfo {
  return useContext(RootContext).action;
}

// ── useCanvas ───────────────────────────────────────────────────────

export function useCanvas(): CanvasInfo {
  return useContext(RootContext).canvas;
}

// ── useStreamDeck ───────────────────────────────────────────────────
// Escape hatch — direct access to the raw SDK action and streamDeck object.

export function useStreamDeck(): StreamDeckAccess {
  return useContext(RootContext).streamDeck;
}
