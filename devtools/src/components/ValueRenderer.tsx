import { useState, type ReactNode } from "react";
import type { SerializedValue } from "../types";

// ── Value Renderer ──────────────────────────────────────────────────
// Recursively renders a SerializedValue with Chrome DevTools-like styling.

export function ValueRenderer({
  value,
  inline = false,
  depth = 0,
}: {
  value: SerializedValue;
  inline?: boolean;
  depth?: number;
}) {
  switch (value.t) {
    case "s":
      return <span className="text-green-400">"{value.v}"</span>;
    case "n":
      return <span className="text-blue-400">{value.v}</span>;
    case "b":
      return <span className="text-purple-400">{String(value.v)}</span>;
    case "null":
      return <span className="text-neutral-500 italic">null</span>;
    case "undef":
      return <span className="text-neutral-500 italic">undefined</span>;
    case "fn":
      return (
        <span className="text-yellow-400 italic">
          f {value.name}()
        </span>
      );
    case "sym":
      return <span className="text-orange-400">Symbol({value.v})</span>;
    case "bigint":
      return <span className="text-blue-400">{value.v}n</span>;
    case "buf":
      return (
        <span className="text-neutral-500">Buffer({value.byteLength})</span>
      );
    case "trunc":
      return <span className="text-neutral-500 italic">[{value.hint}]</span>;
    case "err":
      return <ErrorValue value={value} />;
    case "arr":
      if (inline || depth > 3) return <InlineArray value={value} />;
      return <ExpandableArray value={value} depth={depth} />;
    case "obj":
      if (value.circular)
        return <span className="text-red-400">[Circular]</span>;
      if (inline || depth > 3) return <InlineObject value={value} />;
      return <ExpandableObject value={value} depth={depth} />;
  }
}

// ── Error ───────────────────────────────────────────────────────────

function ErrorValue({
  value,
}: {
  value: Extract<SerializedValue, { t: "err" }>;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <span className="text-red-400">
      <span
        className="cursor-pointer hover:underline"
        onClick={() => setExpanded(!expanded)}
      >
        {value.name}: {value.message}
      </span>
      {expanded && value.stack && (
        <pre className="text-xs text-red-300/70 mt-1 ml-4 whitespace-pre-wrap">
          {value.stack}
        </pre>
      )}
    </span>
  );
}

// ── Inline previews ─────────────────────────────────────────────────

function InlineArray({
  value,
}: {
  value: Extract<SerializedValue, { t: "arr" }>;
}) {
  return (
    <span className="text-neutral-400">
      [{value.v.length > 0 ? `\u2026${value.v.length}` : ""}]
    </span>
  );
}

function InlineObject({
  value,
}: {
  value: Extract<SerializedValue, { t: "obj" }>;
}) {
  const keys = Object.keys(value.v);
  return (
    <span className="text-neutral-400">
      {"{"}
      {keys.slice(0, 3).join(", ")}
      {keys.length > 3 ? ", \u2026" : ""}
      {"}"}
    </span>
  );
}

// ── Expandable containers ───────────────────────────────────────────

function ExpandableArray({
  value,
  depth,
}: {
  value: Extract<SerializedValue, { t: "arr" }>;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <span>
      <Chevron expanded={expanded} onClick={() => setExpanded(!expanded)} />
      {expanded ? (
        <span className="ml-2">
          {"[\n"}
          {value.v.map((item, i) => (
            <span key={i} className="ml-4 block">
              <span className="text-neutral-600 mr-1">{i}:</span>
              <ValueRenderer value={item} depth={depth + 1} />
              {i < value.v.length - 1 ? "," : ""}
            </span>
          ))}
          {"]"}
        </span>
      ) : (
        <InlineArray value={value} />
      )}
    </span>
  );
}

function ExpandableObject({
  value,
  depth,
}: {
  value: Extract<SerializedValue, { t: "obj" }>;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const entries = Object.entries(value.v);
  return (
    <span>
      <Chevron expanded={expanded} onClick={() => setExpanded(!expanded)} />
      {expanded ? (
        <span className="ml-2">
          {"{\n"}
          {entries.map(([key, val], i) => (
            <span key={key} className="ml-4 block">
              <span className="text-purple-300">{key}</span>
              <span className="text-neutral-500">: </span>
              <ValueRenderer value={val} depth={depth + 1} />
              {i < entries.length - 1 ? "," : ""}
            </span>
          ))}
          {"}"}
        </span>
      ) : (
        <InlineObject value={value} />
      )}
    </span>
  );
}

// ── Chevron toggle ──────────────────────────────────────────────────

function Chevron({
  expanded,
  onClick,
}: {
  expanded: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="text-neutral-500 hover:text-neutral-300 mr-1 text-xs inline-block w-3 cursor-pointer"
    >
      {expanded ? "\u25BC" : "\u25B6"}
    </button>
  );
}

// ── Console Args renderer (inline, space-separated) ─────────────────

export function ConsoleArgs({ args }: { args: SerializedValue[] }) {
  return (
    <span className="flex flex-wrap gap-x-2 items-baseline">
      {args.map((arg, i) => (
        <ValueRenderer key={i} value={arg} depth={0} />
      ))}
    </span>
  );
}
