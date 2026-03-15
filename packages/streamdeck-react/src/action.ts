import type { ActionConfig, ActionDefinition } from "./types";
import type { JsonObject } from "@elgato/utils";

// ── defineAction ────────────────────────────────────────────────────
//
// Factory function that creates an ActionDefinition from user config.
// Used by createPlugin to register actions with the SDK.
//
// The `info` field carries manifest metadata and is the primary source
// for manifest.json generation.  The bundler plugin auto-extracts
// `info` from each defineAction() call at build time via AST analysis.
// Set `info.disabled: true` to exclude an action from the manifest.
//
// defaultSettings fallback:
//   If the user doesn't provide defaultSettings, it defaults to an
//   empty object.  These are shallow-merged with the action's stored
//   settings when a root is created.

export function defineAction<S extends JsonObject = JsonObject>(
  config: ActionConfig<S>,
): ActionDefinition<S> {
  return {
    uuid: config.uuid,
    key: config.key,
    dial: config.dial,
    touchStrip: config.touchStrip,
    dialLayout: config.dialLayout,
    wrapper: config.wrapper,
    defaultSettings: config.defaultSettings ?? ({} as Partial<S>),
    info: config.info,
  };
}
