import { useContext, useCallback } from "react";
import {
  SettingsContext,
  GlobalSettingsContext,
} from "@/context/providers";
import type { JsonObject } from "@elgato/utils"

// ── useSettings ─────────────────────────────────────────────────────
// Returns [settings, setSettings] with shallow-merge semantics.
// Bi-directional: updates both React state and persists to the SDK.

export function useSettings<
  S extends JsonObject = JsonObject,
>(): [S, (partial: Partial<S>) => void] {
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

export function useGlobalSettings<
  G extends JsonObject = JsonObject,
>(): [G, (partial: Partial<G>) => void] {
  const ctx = useContext(GlobalSettingsContext);

  const setSettings = useCallback(
    (partial: Partial<G>) => {
      ctx.setSettings(partial as JsonObject);
    },
    [ctx],
  );

  return [ctx.settings as G, setSettings];
}
