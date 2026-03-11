import { useContext, useCallback } from "react";
import { SettingsContext, GlobalSettingsContext } from "@/context/providers";
import type { JsonObject } from "@elgato/utils";

// ── Settings Hooks ──────────────────────────────────────────────────
//
// Bi-directional settings binding:
//
//   setSettings(partial)
//     1. Shallow-merge partial into current settings object
//     2. Update the React context value → triggers re-render
//     3. Persist to SDK via action.setSettings() → survives plugin restart
//
//   External SDK update (Property Inspector, etc.)
//     1. onDidReceiveSettings → registry.updateSettings()
//     2. ReactRoot.updateSettings() → replaces context value
//     3. EventBus emits "settingsChanged" → scheduleRerender()
//
// useGlobalSettings follows the same pattern but operates on the
// plugin-wide settings shared across all actions.

// ── useSettings ─────────────────────────────────────────────────────
// Returns [settings, setSettings] with shallow-merge semantics.
// Bi-directional: updates both React state and persists to the SDK.

export function useSettings<S extends JsonObject = JsonObject>(): [
  S,
  (partial: Partial<S>) => void,
] {
  const ctx = useContext(SettingsContext);

  const setSettings = useCallback(
    (partial: Partial<S>) => {
      ctx.setSettings(partial as JsonObject);
    },
    [ctx],
  );

  return [ctx.settings as S, setSettings];
}

// ── useGlobalSettings ───────────────────────────────────────────────
// Same pattern as useSettings, but for plugin-wide global settings.

export function useGlobalSettings<G extends JsonObject = JsonObject>(): [
  G,
  (partial: Partial<G>) => void,
] {
  const ctx = useContext(GlobalSettingsContext);

  const setSettings = useCallback(
    (partial: Partial<G>) => {
      ctx.setSettings(partial as JsonObject);
    },
    [ctx],
  );

  return [ctx.settings as G, setSettings];
}
