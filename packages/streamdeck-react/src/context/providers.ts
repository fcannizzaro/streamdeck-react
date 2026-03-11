import { createContext } from "react";
import type { EventBus } from "./event-bus";
import type { ActionInfo, CanvasInfo, DeviceInfo, StreamDeckAccess } from "@/types";
import type { JsonObject } from "@elgato/utils";

// ── React Context Definitions ───────────────────────────────────────
//
// Seven contexts are nested inside each ReactRoot's provider tree.
// They are ordered by stability (outer = rarely changes, inner =
// changes often) to minimize unnecessary subtree re-renders:
//
//   Stable (never change for a given root):
//     ActionContext    — action ID, UUID, controller type
//     DeviceContext    — device ID, type, size, name
//     CanvasContext    — pixel dimensions, surface type
//     EventBusContext  — the root's EventBus instance
//     StreamDeckContext— raw SDK action + streamDeck object
//
//   Volatile (change during root lifetime):
//     GlobalSettingsContext — plugin-wide settings (less frequent)
//     SettingsContext       — per-action settings (most frequent)
//
// All contexts default to `null!` — they are always provided by the
// root and should never be consumed outside of one.

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

// ── Action Context ──────────────────────────────────────────────────

export const ActionContext = createContext<ActionInfo>(null!);

// ── Device Context ──────────────────────────────────────────────────

export const DeviceContext = createContext<DeviceInfo>(null!);

// ── Canvas Context ──────────────────────────────────────────────────

export const CanvasContext = createContext<CanvasInfo>(null!);

// ── Event Bus Context ───────────────────────────────────────────────

export const EventBusContext = createContext<EventBus>(null!);

// ── StreamDeck Context ──────────────────────────────────────────────

export const StreamDeckContext = createContext<StreamDeckAccess>(null!);
