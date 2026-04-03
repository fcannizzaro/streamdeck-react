// ── Root Recycling Pool ──────────────────────────────────────────────
//
// Reuses dormant React fiber roots when actions rapidly disappear and
// reappear, avoiding the most expensive React operation: creating and
// destroying a full fiber tree.
//
// When this happens:
//   - User switches Stream Deck profiles (all keys disappear, new ones appear)
//   - User navigates pages on a multi-page layout
//   - User drags actions around the Stream Deck configuration
//
// Without recycling, each willDisappear → willAppear cycle:
//   1. Destroys fiber root (expensive reconciler teardown)
//   2. Creates new fiber root (expensive reconciler initialization)
//   3. Runs initial render (full component mount)
//   Total: ~5-15ms per key, 32 keys = ~160-480ms
//
// With recycling:
//   1. Root suspended (fiber tree kept alive, timers cleared)
//   2. Root resumed with new context (just a context update + re-render)
//   Total: ~1-3ms per key, 32 keys = ~32-96ms
//
// Architecture:
//
//   willDisappear(actionId)
//     ↓
//   root.suspend()  — clears timers, emits willDisappear, but keeps fiber root
//     ↓
//   pool.store(poolKey, root)  — keyed by (actionUUID, canvasType)
//     ↓
//   ... time passes ...
//     ↓
//   willAppear(newActionId, same UUID, same canvas)
//     ↓
//   pool.take(poolKey)  — returns the suspended root (if available)
//     ↓
//   root.resume(newActionInfo, newSettings, ...)  — updates contexts, re-renders
//
// Pool key:
//   Keyed by `${actionUUID}:${canvasType}` — a root can only be reused
//   for the same action type on the same surface type.  Different UUIDs
//   have different components; different canvas types have different
//   pixel dimensions and feedback layouts.
//
// Eviction:
//   - Maximum pool size limits dormant memory (configurable, default 16)
//   - LRU eviction: oldest dormant roots are destroyed first
//   - Explicit eviction on destroyAll()
//
// Invariant:
//   A recycled root MUST have its contexts fully updated before the
//   user component re-renders.  The resume() method handles this by
//   updating all mutable state before calling scheduleRerender().

// ── Pool Key ────────────────────────────────────────────────────────

export function makePoolKey(actionUuid: string, canvasType: string): string {
  return `${actionUuid}:${canvasType}`;
}

// ── Pool Entry ──────────────────────────────────────────────────────

interface PoolEntry<T> {
  key: string;
  root: T;
  storedAt: number;
}

// ── Root Recycling Pool ─────────────────────────────────────────────

export class RootRecyclingPool<T extends { unmount(): void }> {
  private pool: PoolEntry<T>[] = [];
  private readonly maxSize: number;

  constructor(maxSize = 16) {
    this.maxSize = maxSize;
  }

  /**
   * Store a dormant root in the pool.  If the pool is full, the
   * oldest entry is evicted (unmounted and destroyed).
   */
  store(key: string, root: T): void {
    // Evict if at capacity
    while (this.pool.length >= this.maxSize) {
      const evicted = this.pool.shift();
      if (evicted) {
        evicted.root.unmount();
      }
    }

    this.pool.push({ key, root, storedAt: Date.now() });
  }

  /**
   * Take a dormant root from the pool matching the given key.
   * Returns null if no matching root is available.
   * The returned root is removed from the pool.
   */
  take(key: string): T | null {
    const index = this.pool.findIndex((entry) => entry.key === key);
    if (index === -1) return null;

    const entry = this.pool[index]!;
    this.pool.splice(index, 1);
    return entry.root;
  }

  /**
   * Destroy all dormant roots in the pool.
   */
  clear(): void {
    for (const entry of this.pool) {
      entry.root.unmount();
    }
    this.pool = [];
  }

  /** Number of dormant roots currently in the pool. */
  get size(): number {
    return this.pool.length;
  }
}
