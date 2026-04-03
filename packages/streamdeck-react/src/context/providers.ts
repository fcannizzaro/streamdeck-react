import { createContext } from "react";
import type { EventBus } from "./event-bus";
import type { ActionInfo, CanvasInfo, DeviceInfo, StreamDeckAccess } from "@/types";
import type { JsonObject } from "@elgato/utils";

// ── React Context Definitions ───────────────────────────────────────
//
// Four contexts are nested inside each ReactRoot's provider tree.
// They are ordered by stability (outer = rarely changes, inner =
// changes often) to minimize unnecessary subtree re-renders:
//
//   Stable (never change for a given root):
//     RootContext    — merged context for action, device, canvas, and
//                     StreamDeck access.  All four values are set once
//                     at root creation and never change for the root's
//                     lifetime.  Merging into one Provider eliminates 3
//                     fiber nodes per root (previously 4 separate Providers
//                     for Action, Device, Canvas, StreamDeck; now 1).
//     EventBusContext — the root's EventBus instance.  Kept standalone
//                      because it's also used by TouchStripRoot, which
//                      doesn't have per-action RootContext values.
//
//   Volatile (change during root lifetime):
//     GlobalSettingsContext — plugin-wide settings (less frequent)
//     SettingsContext       — per-action settings (most frequent)
//
// All contexts default to `null!` — they are always provided by the
// root and should never be consumed outside of one.
//
// Migration from 7 separate contexts to 4:
//   Previously, Action, Device, Canvas, StreamDeck, and EventBus each
//   had their own Provider (5 stable providers).  Now Action, Device,
//   Canvas, StreamDeck are merged into RootContext.  EventBus stays
//   standalone.  For 32 roots: 160 → 64 stable provider fiber nodes,
//   saving 96 fiber nodes and their React reconciler overhead.

// ── Settings Context ────────────────────────────────────────────────

export interface SettingsContextValue {
  settings: JsonObject;
  setSettings: (partial: JsonObject) => void;
}

export const SettingsContext = createContext<SettingsContextValue>(null!);

// ── Global Settings Context ─────────────────────────────────────────

export interface GlobalSettingsContextValue {
  settings: JsonObject;
  setSettings: (partial: JsonObject) => void;
}

export const GlobalSettingsContext = createContext<GlobalSettingsContextValue>(null!);

// ── Root Context (merged stable contexts) ───────────────────────────
//
// Combines per-root stable values into a single context:
//   - ActionInfo       (action ID, UUID, controller type, coordinates)
//   - DeviceInfo       (device ID, type, size, name)
//   - CanvasInfo       (pixel dimensions, surface type)
//   - StreamDeckAccess (raw SDK action + adapter)
//
// This value is constructed once at root creation and never changes
// for the root's lifetime.  Since all fields are stable, hooks that
// consume individual pieces (e.g. useDevice()) do not suffer from
// unnecessary re-renders — the merged object reference is stable.
//
// Not included: EventBus (used by both ReactRoot and TouchStripRoot,
// kept standalone for compatibility).

export interface RootContextValue {
  action: ActionInfo;
  device: DeviceInfo;
  canvas: CanvasInfo;
  streamDeck: StreamDeckAccess;
}

export const RootContext = createContext<RootContextValue>(null!);

// ── Event Bus Context ───────────────────────────────────────────────
//
// Per-root EventBus instance.  Standalone because it's used by both
// ReactRoot (key/dial actions) and TouchStripRoot (shared per-device).
// Both root types provide this context.

export const EventBusContext = createContext<EventBus>(null!);

// ── Device Context ──────────────────────────────────────────────────
//
// Standalone DeviceContext is used by TouchStripRoot, which does not
// have per-action ActionInfo, CanvasInfo, or StreamDeckAccess.
// For ReactRoot, DeviceInfo is provided via RootContext.

export const DeviceContext = createContext<DeviceInfo>(null!);
