// ── Render Metrics ──────────────────────────────────────────────────
//
// Aggregates render pipeline statistics.  Enabled in debug mode to
// quantify the impact of each optimization tier:
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
// A single set of cumulative counters is used.  The periodic console
// reporter computes deltas from the last snapshot.  The devtools
// bridge reads the cumulative totals directly via snapshot().

import {
  getImageCacheStats,
  getTouchStripCacheStats,
  getTouchStripSegmentCacheStats,
} from "./image-cache";

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
  /** TouchStrip cache memory usage in bytes. */
  touchStripCacheBytes: number;
}

// ── Metrics Collector ───────────────────────────────────────────────

const REPORT_INTERVAL_MS = 10_000; // Log every 10s in debug mode

class MetricsCollector {
  // ── Cumulative counters (monotonically increasing) ────────────────
  private _flushCount = 0;
  private _renderCount = 0;
  private _cacheHitCount = 0;
  private _dirtySkipCount = 0;
  private _hashDedupCount = 0;
  private _totalRenderMs = 0;
  private _peakRenderMs = 0;

  // ── Last-reported snapshot (for computing deltas in report()) ─────
  private _lastFlush = 0;
  private _lastRender = 0;
  private _lastCacheHit = 0;
  private _lastDirtySkip = 0;
  private _lastHashDedup = 0;
  private _lastTotalRenderMs = 0;
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
  }

  /** Record a dirty-skip (container was clean). */
  recordDirtySkip(): void {
    this._dirtySkipCount++;
  }

  /** Record an image cache hit. */
  recordCacheHit(): void {
    this._cacheHitCount++;
  }

  /** Record a post-render hash dedup (identical output). */
  recordHashDedup(): void {
    this._hashDedupCount++;
  }

  /** Record a completed render with its duration in milliseconds. */
  recordRender(renderMs: number): void {
    this._renderCount++;
    this._totalRenderMs += renderMs;
    if (renderMs > this._peakRenderMs) {
      this._peakRenderMs = renderMs;
    }
  }

  /** Get current snapshot of all metrics (cumulative). */
  snapshot(): RenderMetrics {
    const imageStats = getImageCacheStats();
    const touchStripStats = getTouchStripCacheStats();
    const segmentStats = getTouchStripSegmentCacheStats();
    return {
      flushCount: this._flushCount,
      renderCount: this._renderCount,
      cacheHitCount: this._cacheHitCount,
      dirtySkipCount: this._dirtySkipCount,
      hashDedupCount: this._hashDedupCount,
      avgRenderMs: this._renderCount > 0 ? this._totalRenderMs / this._renderCount : 0,
      peakRenderMs: this._peakRenderMs,
      imageCacheBytes: imageStats.bytes,
      // Sum raw buffer cache + segment URI cache. The TouchStrip runtime
      // can populate both during normal operation: a segment-cache miss falls
      // through to renderToRaw(), which may hit or fill the raw buffer cache.
      touchStripCacheBytes: touchStripStats.bytes + segmentStats.bytes,
    };
  }

  /** Log a summary to console (called periodically). Computes deltas since last report. */
  private report(): void {
    // Compute deltas since last report
    const dFlush = this._flushCount - this._lastFlush;
    if (dFlush === 0) return; // nothing to report

    const dRender = this._renderCount - this._lastRender;
    const dCacheHit = this._cacheHitCount - this._lastCacheHit;
    const dDirtySkip = this._dirtySkipCount - this._lastDirtySkip;
    const dHashDedup = this._hashDedupCount - this._lastHashDedup;
    const dTotalMs = this._totalRenderMs - this._lastTotalRenderMs;

    const skipRate =
      dFlush > 0 ? (((dDirtySkip + dCacheHit + dHashDedup) / dFlush) * 100).toFixed(1) : "0";
    const avgMs = dRender > 0 ? (dTotalMs / dRender).toFixed(1) : "0.0";

    console.log(
      `[@fcannizzaro/streamdeck-react] Metrics (${REPORT_INTERVAL_MS / 1000}s): ` +
        `flushes=${dFlush} renders=${dRender} ` +
        `cacheHits=${dCacheHit} dirtySkips=${dDirtySkip} hashDedups=${dHashDedup} ` +
        `skipRate=${skipRate}% ` +
        `avgRender=${avgMs}ms peak=${this._peakRenderMs.toFixed(1)}ms ` +
        `imgCache=${(getImageCacheStats().bytes / 1024).toFixed(0)}KB ` +
        `tbCache=${((getTouchStripCacheStats().bytes + getTouchStripSegmentCacheStats().bytes) / 1024).toFixed(0)}KB`,
    );

    // Save current values as the last-reported baseline
    this._lastFlush = this._flushCount;
    this._lastRender = this._renderCount;
    this._lastCacheHit = this._cacheHitCount;
    this._lastDirtySkip = this._dirtySkipCount;
    this._lastHashDedup = this._hashDedupCount;
    this._lastTotalRenderMs = this._totalRenderMs;
  }
}

// ── Shared Singleton ────────────────────────────────────────────────

export const metrics = new MetricsCollector();
