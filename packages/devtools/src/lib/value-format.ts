import type { SerializedValue } from "../types";

// ── Format SerializedValue to display string ────────────────────────

export function formatValue(val: SerializedValue): string {
  switch (val.t) {
    case "s":
      return `"${val.v}"`;
    case "n":
      return String(val.v);
    case "b":
      return String(val.v);
    case "null":
      return "null";
    case "undef":
      return "undefined";
    case "fn":
      return `f ${val.name}()`;
    case "sym":
      return `Symbol(${val.v})`;
    case "bigint":
      return `${val.v}n`;
    case "buf":
      return `Buffer(${val.byteLength})`;
    case "trunc":
      return `[${val.hint}]`;
    case "err":
      return `${val.name}: ${val.message}`;
    case "arr":
      return `Array(${val.v.length})`;
    case "obj":
      if (val.circular) return "[Circular]";
      return `{${Object.keys(val.v).join(", ")}}`;
  }
}

// ── Inline preview (single line) ────────────────────────────────────

export function inlinePreview(val: SerializedValue, maxLen = 80): string {
  const s = formatValue(val);
  return s.length > maxLen ? s.slice(0, maxLen - 3) + "..." : s;
}
