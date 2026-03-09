import type { SerializedValue } from "../types";

// ── Safe Value Serialization ────────────────────────────────────────
// Converts arbitrary JS values into a JSON-safe SerializedValue format.
// Handles circular references, depth limits, large strings, etc.

const MAX_STRING_LENGTH = 10_000;
const MAX_ARRAY_ITEMS = 100;
const MAX_OBJECT_KEYS = 100;

export function serializeValue(
  value: unknown,
  maxDepth: number,
  seen: WeakSet<object> = new WeakSet(),
): SerializedValue {
  // ── Primitives ────────────────────────────────────────────────
  if (value === null) return { t: "null" };
  if (value === undefined) return { t: "undef" };

  if (typeof value === "string") {
    return value.length > MAX_STRING_LENGTH
      ? { t: "trunc", hint: `string(${value.length})` }
      : { t: "s", v: value };
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? { t: "n", v: value } : { t: "s", v: String(value) };
  }

  if (typeof value === "boolean") return { t: "b", v: value };
  if (typeof value === "bigint") return { t: "bigint", v: value.toString() };
  if (typeof value === "symbol") return { t: "sym", v: value.description ?? "" };
  if (typeof value === "function") return { t: "fn", name: value.name || "anonymous" };

  // ── Objects ───────────────────────────────────────────────────
  if (typeof value === "object") {
    // Circular reference check
    if (seen.has(value as object)) {
      return { t: "obj", v: {}, circular: true };
    }
    seen.add(value as object);

    // Depth limit
    if (maxDepth <= 0) {
      return { t: "trunc", hint: typeof value };
    }

    // Error
    if (value instanceof Error) {
      return {
        t: "err",
        name: value.name,
        message: value.message,
        stack: value.stack,
      };
    }

    // Buffer / ArrayBuffer / TypedArray
    if (
      (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) ||
      value instanceof ArrayBuffer ||
      ArrayBuffer.isView(value)
    ) {
      return {
        t: "buf",
        byteLength: (value as { byteLength?: number }).byteLength ?? 0,
      };
    }

    // Array
    if (Array.isArray(value)) {
      if (value.length > MAX_ARRAY_ITEMS) {
        const items = value
          .slice(0, MAX_ARRAY_ITEMS)
          .map((v) => serializeValue(v, maxDepth - 1, seen));
        items.push({ t: "trunc", hint: `+${value.length - MAX_ARRAY_ITEMS} items` });
        return { t: "arr", v: items };
      }
      return {
        t: "arr",
        v: value.map((v) => serializeValue(v, maxDepth - 1, seen)),
      };
    }

    // Plain object
    const entries = Object.entries(value as Record<string, unknown>);
    const obj: Record<string, SerializedValue> = {};
    let count = 0;
    for (const [k, v] of entries) {
      if (count >= MAX_OBJECT_KEYS) {
        obj["..."] = { t: "trunc", hint: `+${entries.length - MAX_OBJECT_KEYS} keys` };
        break;
      }
      obj[k] = serializeValue(v, maxDepth - 1, seen);
      count++;
    }
    return { t: "obj", v: obj };
  }

  return { t: "trunc", hint: String(typeof value) };
}
