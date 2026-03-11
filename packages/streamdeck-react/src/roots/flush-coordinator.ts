// ── Flush Coordinator ────────────────────────────────────────────────
//
// Batches and priority-orders flush requests from multiple ReactRoot
// and TouchBarRoot instances.
//
// Problem: when a Stream Deck has 15 keys + 4 encoders all animating,
// 19 roots may request flushes in the same tick.  Without coordination,
// they race for the USB bus and lower-priority updates (settings changes)
// can starve higher-priority ones (animations, key press feedback).
//
// Solution: microtask-based batching with priority sorting.
//
//   requestFlush(root) → add to pending Set
//     ↓ (microtask boundary)
//   drain():
//     1. Snapshot pending Set, clear it
//     2. Sort by root.priority (0=animating, 1=interactive, 2=normal, 3=idle)
//     3. Execute flushes sequentially in priority order
//        (sequential ensures higher-priority roots finish their
//        hardware push before lower-priority ones start)
//     4. If new requests arrived during drain, schedule another microtask
//
// Why sequential (not parallel):
//   The Stream Deck USB connection serializes write operations.
//   Parallel hardware pushes just queue in the USB driver anyway.
//   Sequential processing gives animated/interactive keys guaranteed
//   first access to the USB bus, reducing perceived latency.

/** Any root that can participate in prioritized flushing. */
export interface FlushableRoot {
  /** Current render priority. 0 = animating (highest), 3 = idle (lowest). */
  readonly priority: number;
  /** Execute the flush (render + push to hardware). */
  executeFlush(): Promise<void>;
}

export class FlushCoordinator {
  private pending = new Set<FlushableRoot>();
  private scheduled = false;
  private draining = false;

  /**
   * Enqueue a root for flushing. Flushes are batched via microtask
   * and processed in priority order.
   */
  requestFlush(root: FlushableRoot): void {
    this.pending.add(root);

    if (!this.scheduled && !this.draining) {
      this.scheduled = true;
      queueMicrotask(() => this.drain());
    }
  }

  private async drain(): Promise<void> {
    this.scheduled = false;

    if (this.draining || this.pending.size === 0) return;
    this.draining = true;

    try {
      while (this.pending.size > 0) {
        // Snapshot and clear — new requests during processing go to next cycle
        const roots = [...this.pending];
        this.pending.clear();

        // Sort by priority (lower number = higher priority)
        roots.sort((a, b) => a.priority - b.priority);

        // Process in priority order. Each root's flush is awaited sequentially
        // so higher-priority roots finish (including hardware push) before
        // lower-priority ones start. This gives animated/interactive keys
        // first access to the USB bus.
        for (const root of roots) {
          await root.executeFlush();
        }
      }
    } finally {
      this.draining = false;

      // If new requests arrived during finally, schedule another drain
      if (this.pending.size > 0 && !this.scheduled) {
        this.scheduled = true;
        queueMicrotask(() => this.drain());
      }
    }
  }
}
