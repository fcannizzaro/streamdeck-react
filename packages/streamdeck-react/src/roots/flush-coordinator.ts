import type { RenderConfig } from "@/render/pipeline";

// ── Flush Coordinator ────────────────────────────────────────────────
//
// Batches and priority-orders flush requests from multiple ReactRoot
// and TouchStripRoot instances.
//
// Problem solved:
//   Without coordination, N roots have N independent debounce timers.
//   On a Stream Deck XL (32 keys), all timers can fire at the same
//   moment, creating a burst of 32 sequential Takumi renders (~5-15ms
//   each = 160-480ms main-thread block).  The USB bus serializes
//   hardware pushes anyway, so uncoordinated parallel flushes just
//   queue up with no benefit.
//
// Solution:
//   A single coordinator collects flush requests from all roots and
//   processes them in priority order on one coordinated debounce timer.
//
//   Root A → requestFlush(INTERACTIVE)  ─┐
//   Root B → requestFlush(IDLE)          ─┤  FlushCoordinator
//   Root C → requestFlush(ANIMATING)     ─┤    ├─ 17ms debounce from FIRST request
//   Root D → requestFlush(INTERACTIVE)   ─┘    ├─ Sort by priority
//                                              └─ Process sequentially
//
//   Processing order: C (animating) → A → D (interactive) → B (idle)
//
// Priority levels:
//
//   ANIMATING   (0) — Active animation loop (useSpring, useTween, useTick).
//                     Gets first access to the Takumi renderer and USB bus.
//   INTERACTIVE (1) — User-triggered update (keyDown, settings change).
//                     Renders promptly after animations.
//   IDLE        (2) — Background update (global settings, timer-based refresh).
//                     Deferred until interactive/animated work is done.
//
// Sequential processing rationale:
//   The Stream Deck USB connection serializes write operations.
//   Parallel hardware pushes just queue in the USB driver anyway.
//   Sequential processing gives animated/interactive keys guaranteed
//   first access to the USB bus, reducing perceived latency.
//
// Architecture:
//
//   ┌─────────────────────────────────────────────┐
//   │  pendingFlushes: Map<rootId, FlushEntry>     │
//   │                                             │
//   │  On first request → start 17ms timer        │
//   │  Additional requests → merge into pending   │
//   │                                             │
//   │  Timer fires:                               │
//   │    1. Snapshot pending → clear map           │
//   │    2. Sort by priority (ascending)           │
//   │    3. Execute each doFlush() sequentially    │
//   │    4. Errors are isolated per-root           │
//   └─────────────────────────────────────────────┘

// ── Flush Priority ──────────────────────────────────────────────────

export const FlushPriority = {
  ANIMATING: 0,
  INTERACTIVE: 1,
  IDLE: 2,
} as const;

export type FlushPriority = (typeof FlushPriority)[keyof typeof FlushPriority];

// ── Flushable Root Interface ────────────────────────────────────────
//
// Any root (ReactRoot, TouchStripRoot) that participates in
// coordinated flushing must implement this interface.

export interface FlushableRoot {
  /** Unique identifier for this root (action ID or touchStrip:deviceId). */
  readonly flushId: string;
  /** Execute the actual render pipeline (VNode → Takumi → raster → hardware push). */
  executeFlush(): Promise<void>;
}

// ── Flush Entry ─────────────────────────────────────────────────────

interface FlushEntry {
  root: FlushableRoot;
  priority: FlushPriority;
}

// ── Flush Coordinator ───────────────────────────────────────────────

export class FlushCoordinator {
  private pendingFlushes = new Map<string, FlushEntry>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private processing = false;

  // Stream Deck hardware refreshes at max 30Hz.  Half-period debounce
  // (17ms) fires at the midpoint between ticks, coalescing high-frequency
  // state updates without adding perceptible latency.
  private readonly debounceMs: number;
  private readonly renderConfig: RenderConfig;

  constructor(renderConfig: RenderConfig, debounceMs = 17) {
    this.renderConfig = renderConfig;
    this.debounceMs = debounceMs;
  }

  // ── Request a Flush ───────────────────────────────────────────

  /**
   * Schedule a flush for a root.  If the root already has a pending
   * flush, the higher priority (lower number) wins.
   *
   * The first request in a batch starts the debounce timer.
   * Subsequent requests within the debounce window are merged.
   */
  requestFlush(root: FlushableRoot, priority: FlushPriority): void {
    const existing = this.pendingFlushes.get(root.flushId);

    if (existing != null) {
      // Keep the higher priority (lower number wins)
      if (priority < existing.priority) {
        existing.priority = priority;
      }
      return;
    }

    this.pendingFlushes.set(root.flushId, { root, priority });

    // Start the debounce timer on the first request in this batch.
    // If we're already processing a batch (re-entrant flush request
    // during sequential processing), the request is queued for the
    // next batch — do NOT start a new timer mid-processing.
    if (this.timer === null && !this.processing) {
      if (this.debounceMs > 0) {
        this.timer = setTimeout(() => {
          this.timer = null;
          this.processBatch();
        }, this.debounceMs);
      } else {
        // Zero debounce — schedule on next microtask for batching
        // within the same event loop tick.
        queueMicrotask(() => {
          this.processBatch();
        });
      }
    }
  }

  // ── Cancel a pending flush ────────────────────────────────────

  /**
   * Remove a root's pending flush request.  Called when a root is
   * unmounted before its flush fires.
   */
  cancelFlush(rootId: string): void {
    this.pendingFlushes.delete(rootId);
  }

  // ── Process Batch ─────────────────────────────────────────────

  private async processBatch(): Promise<void> {
    if (this.pendingFlushes.size === 0) return;

    // Snapshot and clear the pending map so new requests during
    // processing queue for the next batch.
    const batch = [...this.pendingFlushes.values()];
    this.pendingFlushes.clear();

    // Sort by priority: ANIMATING (0) first, IDLE (2) last.
    // Stable sort preserves insertion order within the same priority
    // (first-requested gets first access to the renderer/USB bus).
    batch.sort((a, b) => a.priority - b.priority);

    // Process sequentially.
    // Why sequential (not parallel):
    //   The Stream Deck USB connection serializes write operations.
    //   Parallel hardware pushes just queue in the USB driver anyway.
    //   Sequential processing gives animated/interactive keys guaranteed
    //   first access to the USB bus, reducing perceived latency.
    this.processing = true;
    try {
      for (const entry of batch) {
        try {
          await entry.root.executeFlush();
        } catch (err) {
          // Error isolation: one root's flush failure doesn't block others
          console.error(
            `[@fcannizzaro/streamdeck-react] Flush error in root ${entry.root.flushId}:`,
            err,
          );
        }
      }
    } finally {
      this.processing = false;
    }

    // If new flush requests arrived during processing, start a
    // new debounce cycle.
    if (this.pendingFlushes.size > 0 && this.timer === null) {
      if (this.debounceMs > 0) {
        this.timer = setTimeout(() => {
          this.timer = null;
          this.processBatch();
        }, this.debounceMs);
      } else {
        queueMicrotask(() => {
          this.processBatch();
        });
      }
    }
  }

  // ── Cleanup ───────────────────────────────────────────────────

  dispose(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pendingFlushes.clear();
  }

  // ── Diagnostics ───────────────────────────────────────────────

  get pendingCount(): number {
    return this.pendingFlushes.size;
  }
}

// ── Singleton ───────────────────────────────────────────────────────

let sharedCoordinator: FlushCoordinator | null = null;

export function getFlushCoordinator(renderConfig: RenderConfig): FlushCoordinator {
  if (sharedCoordinator == null) {
    sharedCoordinator = new FlushCoordinator(renderConfig);
  }
  return sharedCoordinator;
}

export function resetFlushCoordinator(): void {
  sharedCoordinator?.dispose();
  sharedCoordinator = null;
}
