import { useMemo, useRef, useEffect } from "react";
import { useStore } from "../hooks/useStore";
import { Toolbar, ToggleButton } from "../components/Toolbar";
import { ConsoleArgs } from "../components/ValueRenderer";

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

      <div
        ref={listRef}
        className="flex-1 overflow-auto font-mono text-xs"
        onScroll={handleScroll}
      >
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full text-neutral-600 text-xs">
            No console output
          </div>
        ) : (
          filtered.map((log) => (
            <LogRow key={log.id} log={log} />
          ))
        )}
      </div>
    </div>
  );
}

// ── Log Row ─────────────────────────────────────────────────────────

function LogRow({ log }: { log: import("../types").ConsoleMessage }) {
  const colors = LEVEL_COLORS[log.level] ?? LEVEL_COLORS.log;
  const time = new Date(log.ts);
  const ts = `${time.getHours().toString().padStart(2, "0")}:${time.getMinutes().toString().padStart(2, "0")}:${time.getSeconds().toString().padStart(2, "0")}.${time.getMilliseconds().toString().padStart(3, "0")}`;

  return (
    <div
      className={`flex items-start gap-2 px-3 py-1 border-b border-neutral-800/50 hover:bg-neutral-800/50 ${colors.row}`}
    >
      <span className="text-neutral-600 shrink-0 w-20 select-none">{ts}</span>
      <span
        className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded w-12 text-center ${colors.badge}`}
      >
        {log.level}
      </span>
      <div className="flex-1 min-w-0 break-words">
        <ConsoleArgs args={log.args} />
      </div>
    </div>
  );
}
