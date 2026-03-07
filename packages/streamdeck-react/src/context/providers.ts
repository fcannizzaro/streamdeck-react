import { createContext } from "react";
import type { EventBus } from "./event-bus.ts";
import type {
  ActionInfo,
  CanvasInfo,
  DeviceInfo,
  StreamDeckAccess,
} from "@/types.ts";
import type { JsonObject } from "@elgato/utils"

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

export const GlobalSettingsContext =
  createContext<GlobalSettingsContextValue>(null!);

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
