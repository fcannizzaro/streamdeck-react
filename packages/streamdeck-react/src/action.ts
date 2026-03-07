import type { ActionConfig, ActionDefinition } from "./types";
import type { JsonObject } from "@elgato/utils"

// ── defineAction ────────────────────────────────────────────────────
// Creates an action definition that maps React components to a
// Stream Deck action UUID. Used by createPlugin to generate the
// internal SingletonAction subclass.

export function defineAction<S extends JsonObject = JsonObject>(
  config: ActionConfig<S>,
): ActionDefinition<S> {
  return {
    uuid: config.uuid,
    key: config.key,
    dial: config.dial,
    touch: config.touch,
    touchBar: config.touchBar,
    touchBarFPS: config.touchBarFPS,
    dialLayout: config.dialLayout,
    wrapper: config.wrapper,
    defaultSettings: config.defaultSettings ?? ({} as Partial<S>),
  };
}
