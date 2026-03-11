// ── Render Metrics ──────────────────────────────────────────────────
//
// Aggregates render pipeline statistics over rolling 10-second windows.
// Enabled in debug mode to quantify the impact of each optimization tier:
//
//   flushCount       — total render attempts (flush() calls)
//   dirtySkipCount   — Phase 1 skips (VNode tree was clean)
//   cacheHitCount    — Phase 2 skips (Merkle hash matched image cache)
//   hashDedupCount   — Phase 4 skips (FNV-1a output identical to last frame)
//   renderCount      — renders that reached Takumi (phases 1-4 didn't skip)
//
// The skip rate = (dirtySkips + cacheHits + hashDedups) / flushes
// indicates how effectively the caching tiers avoid redundant work.
// A well-optimized plugin typically sees 60-90% skip rates.
//
// Counters are reset after each 10s report to show per-window rates
// rather than cumulative totals.  The report timer uses unref() to
// avoid preventing Node.js process exit.

import { getImageCache, getTouchbarCache } from "./image-cache";

// ── Types ───────────────────────────────────────────────────────────

export interface RenderMetrics {
  /** Total flush() calls (render attempts). */
  flushCount: number;
  /** Flushes that reached the Takumi renderer. */
  renderCount: number;
  /** Tree hash cache hits (Phase 3). */
  cacheHitCount: number;
  /** Skipped due to clean tree — dirty flag check (Phase 2). */
  dirtySkipCount: number;
  /** Skipped due to identical output — post-render FNV-1a dedup. */
  hashDedupCount: number;
  /** Average Takumi render time in milliseconds. */
  avgRenderMs: number;
  /** Peak (worst-case) render time in milliseconds. */
  peakRenderMs: number;
  /** Image cache memory usage in bytes. */
  imageCacheBytes: number;
  /** TouchBar cache memory usage in bytes. */
  touchbarCacheBytes: number;
}

// ── Metrics Collector ───────────────────────────────────────────────

const REPORT_INTERVAL_MS = 10_000; // Log every 10s in debug mode

class MetricsCollector {
  // ── Windowed counters (reset every 10s by report() for console log) ──
  private _flushCount = 0;
  private _renderCount = 0;
  private _cacheHitCount = 0;
  private _dirtySkipCount = 0;
  private _hashDedupCount = 0;
  private _totalRenderMs = 0;
  private _peakRenderMs = 0;

  // ── Cumulative counters (never reset, for devtools snapshot()) ────────
  //
  // The devtools bridge reads metrics via snapshot() every 3 seconds.
  // The console reporter calls report() every 10 seconds and resets the
  // windowed counters.  Without separate cumulative counters, the bridge
  // would periodically see near-zero values right after a report() cycle.
  //
  // By maintaining a second set of counters that are never reset, the
  // devtools always receives monotonically increasing totals.  The UI
  // can compute deltas if it needs per-interval rates.
  //
  //   ┌──────────────────────────────────────────────────────────┐
  //   │  record*()  ──→  _windowed++   (reset by report())      │
  //   │              ──→  _cumulative++ (never reset)            │
  //   │                                                         │
  //   │  report()   ──→  logs _windowed, resets _windowed       │
  //   │  snapshot() ──→  returns _cumulative (stable for UI)    │
  //   └──────────────────────────────────────────────────────────┘
  private _cumFlushCount = 0;
  private _cumRenderCount = 0;
  private _cumCacheHitCount = 0;
  private _cumDirtySkipCount = 0;
  private _cumHashDedupCount = 0;
  private _cumTotalRenderMs = 0;
  private _cumPeakRenderMs = 0;

  private _reportTimer: ReturnType<typeof setInterval> | null = null;
  private _enabled = false;

  /** Enable periodic reporting. Call once during plugin init in debug mode. */
  enable(): void {
    if (this._enabled) return;
    this._enabled = true;
    this._reportTimer = setInterval(() => {
      this.report();
    }, REPORT_INTERVAL_MS);
    // Don't prevent process exit
    if (typeof this._reportTimer === "object" && "unref" in this._reportTimer) {
      this._reportTimer.unref();
    }
  }

  /** Disable periodic reporting and clear the timer. */
  disable(): void {
    if (this._reportTimer != null) {
      clearInterval(this._reportTimer);
      this._reportTimer = null;
    }
    this._enabled = false;
  }

  /** Record a flush attempt (before any skip checks). */
  recordFlush(): void {
    this._flushCount++;
    this._cumFlushCount++;
  }

  /** Record a dirty-skip (container was clean). */
  recordDirtySkip(): void {
    this._dirtySkipCount++;
    this._cumDirtySkipCount++;
  }

  /** Record an image cache hit. */
  recordCacheHit(): void {
    this._cacheHitCount++;
    this._cumCacheHitCount++;
  }

  /** Record a post-render hash dedup (identical output). */
  recordHashDedup(): void {
    this._hashDedupCount++;
    this._cumHashDedupCount++;
  }

  /** Record a completed render with its duration in milliseconds. */
  recordRender(renderMs: number): void {
    this._renderCount++;
    this._cumRenderCount++;
    this._totalRenderMs += renderMs;
    this._cumTotalRenderMs += renderMs;
    if (renderMs > this._peakRenderMs) {
      this._peakRenderMs = renderMs;
    }
    if (renderMs > this._cumPeakRenderMs) {
      this._cumPeakRenderMs = renderMs;
    }
  }

  /** Get current snapshot of all metrics (cumulative, never reset). */
  snapshot(): RenderMetrics {
    const imageStats = getImageCache().stats;
    const touchbarStats = getTouchbarCache().stats;
    return {
      flushCount: this._cumFlushCount,
      renderCount: this._cumRenderCount,
      cacheHitCount: this._cumCacheHitCount,
      dirtySkipCount: this._cumDirtySkipCount,
      hashDedupCount: this._cumHashDedupCount,
      avgRenderMs: this._cumRenderCount > 0 ? this._cumTotalRenderMs / this._cumRenderCount : 0,
      peakRenderMs: this._cumPeakRenderMs,
      imageCacheBytes: imageStats.bytes,
      touchbarCacheBytes: touchbarStats.bytes,
    };
  }

  /** Log a summary to console (called periodically). */
  private report(): void {
    if (this._flushCount === 0) return; // nothing to report

    const m = this.snapshot();
    const skipRate =
      m.flushCount > 0
        ? (((m.dirtySkipCount + m.cacheHitCount + m.hashDedupCount) / m.flushCount) * 100).toFixed(
            1,
          )
        : "0";

    console.log(
      `[@fcannizzaro/streamdeck-react] Metrics (${REPORT_INTERVAL_MS / 1000}s): ` +
        `flushes=${m.flushCount} renders=${m.renderCount} ` +
        `cacheHits=${m.cacheHitCount} dirtySkips=${m.dirtySkipCount} hashDedups=${m.hashDedupCount} ` +
        `skipRate=${skipRate}% ` +
        `avgRender=${m.avgRenderMs.toFixed(1)}ms peak=${m.peakRenderMs.toFixed(1)}ms ` +
        `imgCache=${(m.imageCacheBytes / 1024).toFixed(0)}KB tbCache=${(m.touchbarCacheBytes / 1024).toFixed(0)}KB`,
    );

    // Reset counters for the next interval
    this._flushCount = 0;
    this._renderCount = 0;
    this._cacheHitCount = 0;
    this._dirtySkipCount = 0;
    this._hashDedupCount = 0;
    this._totalRenderMs = 0;
    this._peakRenderMs = 0;
  }
}

// ── Shared Singleton ────────────────────────────────────────────────

export const metrics = new MetricsCollector();
