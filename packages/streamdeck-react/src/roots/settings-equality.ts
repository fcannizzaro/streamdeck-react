import type { JsonObject } from "@elgato/utils";

// ── Settings Equality Helpers ───────────────────────────────────────
// Shared by ReactRoot and TouchBarRoot to avoid unnecessary context
// churn when settings/global-settings writes do not materially change
// any values.

/** Returns true when applying `partial` would change at least one key in `current`. */
export function partialHasChanges(current: JsonObject, partial: JsonObject): boolean {
  const keys = Object.keys(partial);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!;
    if (!Object.is(current[key], partial[key])) {
      return true;
    }
  }
  return false;
}

/** Shallow equality for full settings objects. */
export function shallowEqualSettings(a: JsonObject, b: JsonObject): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  for (let i = 0; i < aKeys.length; i++) {
    const key = aKeys[i]!;
    if (!Object.prototype.hasOwnProperty.call(b, key)) {
      return false;
    }
    if (!Object.is(a[key], b[key])) {
      return false;
    }
  }
  return true;
}
