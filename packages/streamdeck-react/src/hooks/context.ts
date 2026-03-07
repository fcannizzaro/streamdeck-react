import { useContext } from "react";
import {
  ActionContext,
  DeviceContext,
  CanvasContext,
  StreamDeckContext,
} from "@/context/providers.ts";
import type {
  ActionInfo,
  CanvasInfo,
  DeviceInfo,
  StreamDeckAccess,
} from "@/types.ts";

// ── useDevice ───────────────────────────────────────────────────────

export function useDevice(): DeviceInfo {
  return useContext(DeviceContext);
}

// ── useAction ───────────────────────────────────────────────────────

export function useAction(): ActionInfo {
  return useContext(ActionContext);
}

// ── useCanvas ───────────────────────────────────────────────────────

export function useCanvas(): CanvasInfo {
  return useContext(CanvasContext);
}

// ── useStreamDeck ───────────────────────────────────────────────────
// Escape hatch — direct access to the raw SDK action and streamDeck object.

export function useStreamDeck(): StreamDeckAccess {
  return useContext(StreamDeckContext);
}
