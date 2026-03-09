import { useMemo, useRef, useEffect, useState, useCallback } from "react";
import { useStore } from "../hooks/useStore";
import { Toolbar, ToggleButton } from "../components/Toolbar";
import { ConsoleArgs } from "../components/ValueRenderer";
import type { SerializedValue, ConsoleMessage } from "../types";

// ── Console Panel ───────────────────────────────────────────────────

const LEVEL_COLORS: Record<string, { badge: string; row: string }> = {
  log: { badge: "bg-neutral-700 text-neutral-300", row: "" },
  info: { badge: "bg-blue-900/60 text-blue-300", row: "" },
  warn: { badge: "bg-yellow-900/60 text-yellow-300", row: "bg-yellow-950/20" },
  error: { badge: "bg-red-900/60 text-red-300", row: "bg-red-950/20" },
  debug: { badge: "bg-purple-900/60 text-purple-300", row: "" },
};

export function ConsolePanel() {
  const consoleLogs = useStore((s) => s.consoleLogs);
  const consoleFilter = useStore((s) => s.consoleFilter);
  const setConsoleFilter = useStore((s) => s.setConsoleFilter);
  const clearConsole = useStore((s) => s.clearConsole);
  const listRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);

  // Filtered logs
  const filtered = useMemo(() => {
    return consoleLogs.filter((log) => {
      if (!consoleFilter.levels.has(log.level)) return false;
      if (consoleFilter.search) {
        const searchLower = consoleFilter.search.toLowerCase();
        const text = JSON.stringify(log.args).toLowerCase();
        if (!text.includes(searchLower)) return false;
      }
      return true;
    });
  }, [consoleLogs, consoleFilter]);

  // Auto-scroll
  useEffect(() => {
    if (shouldAutoScroll.current && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [filtered.length]);

  const handleScroll = () => {
    if (!listRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = listRef.current;
    shouldAutoScroll.current = scrollHeight - scrollTop - clientHeight < 50;
  };

  const toggleLevel = (level: string) => {
    const newLevels = new Set(consoleFilter.levels);
    if (newLevels.has(level)) newLevels.delete(level);
    else newLevels.add(level);
    setConsoleFilter({ levels: newLevels });
  };

  return (
    <div className="flex flex-col h-full">
      <Toolbar
        search={consoleFilter.search}
        onSearchChange={(search) => setConsoleFilter({ search })}
        onClear={clearConsole}
      >
        {["log", "info", "warn", "error", "debug"].map((level) => (
          <ToggleButton
            key={level}
            label={level}
            active={consoleFilter.levels.has(level)}
            color={LEVEL_COLORS[level]?.badge.split(" ").pop() ?? "text-neutral-300"}
            onClick={() => toggleLevel(level)}
          />
        ))}
        <span className="text-[10px] text-neutral-600 ml-2">
          {filtered.length}/{consoleLogs.length}
        </span>
      </Toolbar>

      <div ref={listRef} className="flex-1 overflow-auto font-mono text-xs" onScroll={handleScroll}>
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full text-neutral-600 text-xs">
            No console output
          </div>
        ) : (
          filtered.map((log) => <LogRow key={log.id} log={log} />)
        )}
      </div>
    </div>
  );
}

// ── Stringify SerializedValue for clipboard ─────────────────────────

function stringifyValue(value: SerializedValue): string {
  switch (value.t) {
    case "s":
      return value.v;
    case "n":
      return String(value.v);
    case "b":
      return String(value.v);
    case "null":
      return "null";
    case "undef":
      return "undefined";
    case "fn":
      return `f ${value.name}()`;
    case "sym":
      return `Symbol(${value.v})`;
    case "bigint":
      return `${value.v}n`;
    case "buf":
      return `Buffer(${value.byteLength})`;
    case "trunc":
      return `[${value.hint}]`;
    case "err":
      return value.stack ?? `${value.name}: ${value.message}`;
    case "arr":
      return `[${value.v.map(stringifyValue).join(", ")}]`;
    case "obj":
      if (value.circular) return "[Circular]";
      return `{${Object.entries(value.v)
        .map(([k, v]) => `${k}: ${stringifyValue(v)}`)
        .join(", ")}}`;
  }
}

function stringifyArgs(args: SerializedValue[]): string {
  return args.map(stringifyValue).join(" ");
}

// ── Log Row ─────────────────────────────────────────────────────────

function LogRow({ log }: { log: ConsoleMessage }) {
  const [copied, setCopied] = useState(false);
  const colors = LEVEL_COLORS[log.level] ?? LEVEL_COLORS.log;
  const time = new Date(log.ts);
  const ts = `${time.getHours().toString().padStart(2, "0")}:${time.getMinutes().toString().padStart(2, "0")}:${time.getSeconds().toString().padStart(2, "0")}.${time.getMilliseconds().toString().padStart(3, "0")}`;

  const handleCopy = useCallback(() => {
    const text = stringifyArgs(log.args);
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [log.args]);

  return (
    <div
      className={`group flex items-start gap-2 px-3 py-1 border-b border-neutral-800/50 hover:bg-neutral-800/50 ${colors.row}`}
    >
      <span className="text-neutral-600 shrink-0 w-20 mr-2 select-none">{ts}</span>
      <span
        className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded w-12 text-center ${colors.badge}`}
      >
        {log.level}
      </span>
      <div className="flex-1 min-w-0 break-words">
        <ConsoleArgs args={log.args} />
      </div>
      <button
        onClick={handleCopy}
        title="Copy to clipboard"
        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-neutral-600 hover:text-neutral-300 cursor-pointer p-0.5"
      >
        {copied ? (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path
              d="M3 7.5l2.5 2.5L11 4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect
              x="4.5"
              y="4.5"
              width="7"
              height="7"
              rx="1"
              stroke="currentColor"
              strokeWidth="1.2"
            />
            <path
              d="M9.5 4.5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v5.5a1 1 0 0 0 1 1h1.5"
              stroke="currentColor"
              strokeWidth="1.2"
            />
          </svg>
        )}
      </button>
    </div>
  );
}
