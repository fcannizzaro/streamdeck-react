import { useMemo, useRef, useEffect } from "react";
import { useStore } from "../hooks/useStore";
import type { MetricsData, ProfileData, ProfileEntry } from "../types";

// ── Performance Panel ───────────────────────────────────────────────
//
// Two-section layout:
//   1. MetricsOverview — aggregate stats from periodic MetricsMessage
//   2. ProfileList — per-render profile history from RenderMessage.profile

// ── Stage Colors ────────────────────────────────────────────────────

const STAGES = [
  { key: "vnodeToElementMs" as const, color: "bg-blue-400", label: "vnode" },
  { key: "fromJsxMs" as const, color: "bg-green-400", label: "jsx" },
  { key: "takumiRenderMs" as const, color: "bg-orange-400", label: "render" },
  { key: "hashMs" as const, color: "bg-purple-400", label: "hash" },
  { key: "base64Ms" as const, color: "bg-cyan-400", label: "base64" },
];

// ── Formatters ──────────────────────────────────────────────────────

function fmtMs(ms: number): string {
  return ms < 0.1 ? "<0.1ms" : `${ms.toFixed(1)}ms`;
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}.${d.getMilliseconds().toString().padStart(3, "0")}`;
}

// ── PerformancePanel ────────────────────────────────────────────────

export function PerformancePanel() {
  const metrics = useStore((s) => s.metrics);
  const profileHistory = useStore((s) => s.profileHistory);
  const clearProfiles = useStore((s) => s.clearProfiles);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-neutral-800 bg-neutral-900/80 shrink-0">
        <span className="text-[10px] text-neutral-500">
          {profileHistory.length} profile{profileHistory.length !== 1 ? "s" : ""}
        </span>
        <button
          onClick={clearProfiles}
          className="ml-auto text-xs text-neutral-500 hover:text-neutral-300 cursor-pointer"
        >
          Clear
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto font-mono text-xs">
        <MetricsOverview metrics={metrics} />
        <ProfileList profiles={profileHistory} />
      </div>
    </div>
  );
}

// ── Metrics Overview ────────────────────────────────────────────────

function MetricsOverview({ metrics }: { metrics: MetricsData | null }) {
  if (!metrics) {
    return (
      <div className="px-3 py-4 text-center text-neutral-600 text-xs border-b border-neutral-800">
        No metrics data yet
      </div>
    );
  }

  const skipRate =
    metrics.flushCount > 0
      ? (
          ((metrics.dirtySkipCount + metrics.cacheHitCount + metrics.hashDedupCount) /
            metrics.flushCount) *
          100
        ).toFixed(1)
      : "0.0";

  return (
    <div className="border-b border-neutral-800">
      <div className="grid grid-cols-3 gap-2 p-3">
        <StatCard label="Flushes" value={String(metrics.flushCount)} />
        <StatCard label="Renders" value={String(metrics.renderCount)} />
        <StatCard label="Skip Rate" value={`${skipRate}%`} accent="text-green-400" />
        <StatCard label="Cache Hits" value={String(metrics.cacheHitCount)} />
        <StatCard label="Dirty Skips" value={String(metrics.dirtySkipCount)} />
        <StatCard label="Hash Dedups" value={String(metrics.hashDedupCount)} />
        <StatCard label="Avg Render" value={fmtMs(metrics.avgRenderMs)} />
        <StatCard label="Peak Render" value={fmtMs(metrics.peakRenderMs)} accent="text-orange-400" />
        <StatCard label="Img Cache" value={fmtBytes(metrics.imageCacheBytes)} />
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="bg-neutral-800/50 rounded p-2">
      <div className="text-[10px] text-neutral-500 mb-0.5">{label}</div>
      <div className={`text-sm font-medium ${accent ?? "text-neutral-200"}`}>{value}</div>
    </div>
  );
}

// ── Profile List ────────────────────────────────────────────────────

function ProfileList({ profiles }: { profiles: ProfileEntry[] }) {
  const listRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);

  // Display most recent first
  const reversed = useMemo(() => [...profiles].reverse(), [profiles]);

  // Auto-scroll to top on new entries (since reversed, top = newest)
  useEffect(() => {
    if (shouldAutoScroll.current && listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, [profiles.length]);

  const handleScroll = () => {
    if (!listRef.current) return;
    shouldAutoScroll.current = listRef.current.scrollTop < 50;
  };

  if (reversed.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-neutral-600 text-xs">
        No render profiles yet
      </div>
    );
  }

  return (
    <div>
      {/* Legend */}
      <div className="flex items-center gap-3 px-3 py-1.5 border-b border-neutral-800/50 text-[10px] text-neutral-600">
        <span>Pipeline stages:</span>
        {STAGES.map((s) => (
          <span key={s.key} className="flex items-center gap-1">
            <span className={`inline-block w-2 h-2 rounded-sm ${s.color} opacity-80`} />
            {s.label}
          </span>
        ))}
      </div>

      <div ref={listRef} className="overflow-auto" onScroll={handleScroll}>
        {reversed.map((entry) => (
          <ProfileRow key={entry.id} entry={entry} />
        ))}
      </div>
    </div>
  );
}

// ── Profile Row ─────────────────────────────────────────────────────

function ProfileRow({ entry }: { entry: ProfileEntry }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1 border-b border-neutral-800/50 hover:bg-neutral-800/50">
      {/* Timestamp */}
      <span className="text-neutral-600 shrink-0 w-20 select-none">{fmtTime(entry.ts)}</span>

      {/* Action ID */}
      <span
        className="text-neutral-500 shrink-0 w-16 truncate"
        title={entry.actionId}
      >
        {entry.actionId.slice(0, 8)}
      </span>

      {/* Total time */}
      <span className="text-neutral-200 shrink-0 w-16 text-right">{fmtMs(entry.totalMs)}</span>

      {/* Badges */}
      <div className="shrink-0 w-14 flex gap-1">
        {entry.cacheHit && (
          <span className="text-[9px] px-1 py-0.5 rounded bg-green-900/40 text-green-400">
            cache
          </span>
        )}
        {entry.skipped && (
          <span className="text-[9px] px-1 py-0.5 rounded bg-yellow-900/40 text-yellow-400">
            skip
          </span>
        )}
      </div>

      {/* Node count */}
      <span className="text-neutral-600 shrink-0 w-10 text-right" title="Node count">
        {entry.nodeCount}n
      </span>

      {/* Stage bar */}
      <StageBar profile={entry} />
    </div>
  );
}

// ── Stage Bar ───────────────────────────────────────────────────────

function StageBar({ profile }: { profile: ProfileData }) {
  const total = profile.totalMs;

  if (total <= 0) {
    return <div className="h-3 bg-neutral-800 rounded flex-1" />;
  }

  return (
    <div
      className="flex h-3 rounded overflow-hidden flex-1"
      title={`${total.toFixed(1)}ms total`}
    >
      {STAGES.map(({ key, color, label }) => {
        const ms = profile[key];
        const pct = (ms / total) * 100;
        if (pct < 0.5) return null;
        return (
          <div
            key={key}
            className={`${color} opacity-80`}
            style={{ width: `${pct}%` }}
            title={`${label}: ${ms.toFixed(2)}ms`}
          />
        );
      })}
    </div>
  );
}
