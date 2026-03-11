// ── Buffer Pool ─────────────────────────────────────────────────────
//
// Reusable buffer pool for fixed-size allocations.  Reduces GC pressure
// during animation by recycling buffers instead of allocating new ones.
//
// Why this matters:
//   At 60fps touchbar rendering, each frame allocates ~320KB of raw RGBA
//   buffers (800×100×4) plus filtered scanline buffers for PNG encoding.
//   Without pooling, V8's GC must collect ~20MB/s of short-lived buffers,
//   causing periodic frame drops visible as stutter on the Stream Deck.
//
// Design:
//   Buffers are bucketed by exact byte size (Map<size, Buffer[]>).
//   acquire() returns a zeroed buffer from the matching bucket, or
//   allocates a new one via Buffer.alloc() if the pool is empty.
//   release() returns a buffer to its size bucket for future reuse.
//
//   MAX_POOL_SIZE_PER_BUCKET (8) prevents unbounded memory growth
//   if the application briefly spikes to many concurrent renders.

/** Maximum number of buffers to retain per size bucket (prevents unbounded growth). */
const MAX_POOL_SIZE_PER_BUCKET = 8;

export class BufferPool {
  private pools = new Map<number, Buffer[]>();

  /** Acquire a zeroed buffer of the given size. Reuses a pooled buffer if available. */
  acquire(size: number): Buffer {
    const pool = this.pools.get(size);
    if (pool != null && pool.length > 0) {
      const buf = pool.pop()!;
      buf.fill(0);
      return buf;
    }
    return Buffer.alloc(size);
  }

  /** Return a buffer to the pool for future reuse. */
  release(buf: Buffer): void {
    let pool = this.pools.get(buf.length);
    if (pool == null) {
      pool = [];
      this.pools.set(buf.length, pool);
    }
    // Cap the pool to prevent unbounded growth
    if (pool.length < MAX_POOL_SIZE_PER_BUCKET) {
      pool.push(buf);
    }
  }

  /** Clear all pooled buffers. */
  clear(): void {
    this.pools.clear();
  }

  /** Current pool statistics. */
  get stats(): { buckets: number; totalBuffers: number; totalBytes: number } {
    let totalBuffers = 0;
    let totalBytes = 0;
    for (const [size, pool] of this.pools) {
      totalBuffers += pool.length;
      totalBytes += size * pool.length;
    }
    return { buckets: this.pools.size, totalBuffers, totalBytes };
  }
}

// ── Shared singleton ────────────────────────────────────────────────

let sharedPool: BufferPool | null = null;

/** Get the shared buffer pool. */
export function getBufferPool(): BufferPool {
  if (sharedPool == null) {
    sharedPool = new BufferPool();
  }
  return sharedPool;
}

/** Reset the shared pool (for testing). */
export function resetBufferPool(): void {
  sharedPool?.clear();
  sharedPool = null;
}
