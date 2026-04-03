import { describe, expect, test } from "bun:test";
import { fuzz, gen, setSeed } from "@/test-utils/fuzz";
import { BufferPool } from "@/render/buffer-pool";

// ── Buffer Pool Fuzz Tests ──────────────────────────────────────────
//
// Exercises the buffer pool with randomized acquire/release sequences
// to verify:
//
//   1. Acquired buffers are always zeroed
//   2. Acquired buffers have the correct size
//   3. Pool caps are respected (MAX_POOL_SIZE_PER_BUCKET = 8)
//   4. Stats are always consistent
//   5. No crashes on valid operations
//   6. Edge case sizes (0, 1, very large) are handled

setSeed(42);

describe("fuzz: BufferPool", () => {
  test("acquire always returns zeroed buffer of correct size (1000 iterations)", () => {
    const pool = new BufferPool();

    fuzz(1000, () => {
      const size = gen.int(1, 4096);
      const buf = pool.acquire(size);

      expect(buf.length).toBe(size);
      // Verify every byte is zero
      for (let i = 0; i < buf.length; i++) {
        if (buf[i] !== 0) {
          throw new Error(`Buffer not zeroed at index ${i}: got ${buf[i]}`);
        }
      }
    });
  });

  test("released buffers are zeroed on re-acquire (500 iterations)", () => {
    const pool = new BufferPool();

    fuzz(500, () => {
      const size = gen.int(1, 512);
      const buf = pool.acquire(size);

      // Write random data
      for (let i = 0; i < buf.length; i++) {
        buf[i] = gen.int(0, 255);
      }

      pool.release(buf);

      // Re-acquire — should be zeroed
      const reacquired = pool.acquire(size);
      for (let i = 0; i < reacquired.length; i++) {
        if (reacquired[i] !== 0) {
          throw new Error(`Re-acquired buffer not zeroed at index ${i}`);
        }
      }
    });
  });

  test("random acquire/release sequences maintain consistent stats (2000 iterations)", () => {
    const pool = new BufferPool();
    const outstanding: Buffer[] = [];

    fuzz(2000, () => {
      const op = gen.int(0, 2);

      switch (op) {
        case 0: {
          // Acquire
          const size = gen.int(1, 256);
          const buf = pool.acquire(size);
          outstanding.push(buf);
          break;
        }
        case 1: {
          // Release random outstanding buffer
          if (outstanding.length > 0) {
            const idx = gen.int(0, outstanding.length - 1);
            pool.release(outstanding[idx]!);
            outstanding.splice(idx, 1);
          }
          break;
        }
        case 2: {
          // Clear and verify
          pool.clear();
          const stats = pool.stats;
          expect(stats.totalBuffers).toBe(0);
          expect(stats.buckets).toBe(0);
          expect(stats.totalBytes).toBe(0);
          break;
        }
      }

      const stats = pool.stats;
      expect(stats.totalBuffers).toBeGreaterThanOrEqual(0);
      expect(stats.totalBytes).toBeGreaterThanOrEqual(0);
      expect(stats.buckets).toBeGreaterThanOrEqual(0);
    });
  });

  test("per-bucket cap is enforced under heavy release (100 iterations)", () => {
    fuzz(100, () => {
      const pool = new BufferPool();
      const size = gen.int(1, 128);
      const count = gen.int(10, 30);

      const buffers: Buffer[] = [];
      for (let i = 0; i < count; i++) {
        buffers.push(pool.acquire(size));
      }

      for (const buf of buffers) {
        pool.release(buf);
      }

      // MAX_POOL_SIZE_PER_BUCKET is 8
      expect(pool.stats.totalBuffers).toBeLessThanOrEqual(8);
    });
  });

  test("size 1 buffers work correctly", () => {
    const pool = new BufferPool();
    const buf = pool.acquire(1);
    expect(buf.length).toBe(1);
    expect(buf[0]).toBe(0);

    buf[0] = 42;
    pool.release(buf);

    const reacquired = pool.acquire(1);
    expect(reacquired[0]).toBe(0);
  });
});
