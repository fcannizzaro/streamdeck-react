import { describe, expect, test } from "bun:test";
import { BufferPool } from "@/render/buffer-pool";

describe("BufferPool", () => {
  test("acquire returns a zeroed buffer of the requested size", () => {
    const pool = new BufferPool();
    const buf = pool.acquire(16);

    expect(buf.length).toBe(16);
    expect(buf.every((b) => b === 0)).toBe(true);
  });

  test("release and re-acquire reuses the same buffer", () => {
    const pool = new BufferPool();
    const buf1 = pool.acquire(32);

    // Write some data
    buf1[0] = 0xff;
    pool.release(buf1);

    // Re-acquire should return the same (now zeroed) buffer
    const buf2 = pool.acquire(32);
    expect(buf2).toBe(buf1);
    expect(buf2[0]).toBe(0); // zeroed on re-acquire
  });

  test("acquire creates new buffer when pool is empty", () => {
    const pool = new BufferPool();
    const buf1 = pool.acquire(64);
    const buf2 = pool.acquire(64);

    // Two distinct allocations since nothing was released
    expect(buf1).not.toBe(buf2);
  });

  test("different sizes use different pool buckets", () => {
    const pool = new BufferPool();
    const buf16 = pool.acquire(16);
    const buf32 = pool.acquire(32);

    pool.release(buf16);
    pool.release(buf32);

    // Should get back the 32-byte buffer, not the 16-byte one
    const reacquired32 = pool.acquire(32);
    expect(reacquired32).toBe(buf32);
    expect(reacquired32.length).toBe(32);

    const reacquired16 = pool.acquire(16);
    expect(reacquired16).toBe(buf16);
    expect(reacquired16.length).toBe(16);
  });

  test("pool caps at MAX_POOL_SIZE_PER_BUCKET (8)", () => {
    const pool = new BufferPool();
    const buffers: Buffer[] = [];

    // Allocate 10 buffers and release them all
    for (let i = 0; i < 10; i++) {
      buffers.push(pool.acquire(64));
    }
    for (const buf of buffers) {
      pool.release(buf);
    }

    // Stats should show at most 8 buffers
    expect(pool.stats.totalBuffers).toBe(8);
  });

  test("clear removes all pooled buffers", () => {
    const pool = new BufferPool();
    const buf = pool.acquire(128);
    pool.release(buf);

    expect(pool.stats.totalBuffers).toBe(1);

    pool.clear();

    expect(pool.stats.totalBuffers).toBe(0);
    expect(pool.stats.buckets).toBe(0);
    expect(pool.stats.totalBytes).toBe(0);
  });

  test("stats reports correct bucket count and byte totals", () => {
    const pool = new BufferPool();

    // Acquire multiple buffers of each size before releasing
    const buf16a = pool.acquire(16);
    const buf16b = pool.acquire(16);
    const buf32 = pool.acquire(32);

    pool.release(buf16a);
    pool.release(buf16b);
    pool.release(buf32);

    const stats = pool.stats;
    expect(stats.buckets).toBe(2); // 16 and 32
    expect(stats.totalBuffers).toBe(3);
    expect(stats.totalBytes).toBe(16 + 16 + 32);
  });
});
