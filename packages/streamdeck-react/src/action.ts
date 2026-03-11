import type { ActionConfigInput, ActionDefinition } from "./types";
import type { JsonObject } from "@elgato/utils";

// ── defineAction ────────────────────────────────────────────────────
//
// Factory function that creates an ActionDefinition from user config.
// Used by createPlugin to register actions with the SDK.
//
// Type narrowing:
//   The `config` parameter uses `ActionConfigInput<S>` which, when
//   ManifestActions is populated, becomes a discriminated union that
//   enforces UUID validity and requires key/dial/touchBar based on
//   the manifest's Controllers array.  This means TypeScript will
//   error at the call site if:
//     - The UUID is not in the manifest
//     - A Keypad action is missing `key`
//     - An Encoder action is missing both `dial` and `touchBar`
//
//   When ManifestActions is empty (no streamdeck-env.d.ts), all
//   properties are optional and UUID is a plain string.
//
// defaultSettings fallback:
//   If the user doesn't provide defaultSettings, it defaults to an
//   empty object.  These are shallow-merged with the action's stored
//   settings when a root is created.

export function defineAction<S extends JsonObject = JsonObject>(
  config: ActionConfigInput<S>,
): ActionDefinition<S> {
  return {
    uuid: config.uuid,
    key: config.key,
    dial: config.dial,
    touchBar: config.touchBar,
    touchBarFPS: config.touchBarFPS,
    dialLayout: config.dialLayout,
    wrapper: config.wrapper,
    defaultSettings: config.defaultSettings ?? ({} as Partial<S>),
  };
}
