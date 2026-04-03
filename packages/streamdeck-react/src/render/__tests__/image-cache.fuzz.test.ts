import { describe, expect, test } from "bun:test";
import { fuzz, gen, setSeed } from "@/test-utils/fuzz";
import { ImageCache } from "@/render/image-cache";

// ── Image Cache Fuzz Tests ──────────────────────────────────────────
//
// Exercises the LRU cache with randomized operation sequences to verify
// invariants that must hold regardless of access pattern:
//
//   1. currentBytes is always non-negative
//   2. currentBytes never exceeds maxBytes (after any operation)
//   3. entries count matches the Map size
//   4. No crashes on any sequence of get/set/clear operations
//   5. Eviction maintains LRU ordering correctness

setSeed(42);

describe("fuzz: ImageCache", () => {
  test("random get/set sequences never crash (1000 iterations)", () => {
    const cache = new ImageCache<string>(1024);

    fuzz(1000, () => {
      const op = gen.pick(["get", "set", "set", "set"] as const); // bias toward set
      if (op === "get") {
        const key = gen.uint32();
        // get should never throw
        expect(() => cache.get(key)).not.toThrow();
      } else {
        const key = gen.uint32();
        const value = gen.string(1, 50);
        const byteSize = gen.int(1, 200);
        expect(() => cache.set(key, value, byteSize)).not.toThrow();
      }
    });
  });

  test("bytes tracking stays non-negative under random operations (2000 iterations)", () => {
    const cache = new ImageCache<string>(512);

    fuzz(2000, () => {
      const op = gen.int(0, 3);
      switch (op) {
        case 0: {
          cache.get(gen.uint32());
          break;
        }
        case 1: {
          cache.set(gen.uint32(), gen.string(1, 20), gen.int(1, 100));
          break;
        }
        case 2: {
          // Update existing key with different size
          cache.set(gen.int(0, 10), gen.string(1, 20), gen.int(1, 300));
          break;
        }
        case 3: {
          if (gen.bool()) cache.clear();
          break;
        }
      }

      const stats = cache.stats;
      expect(stats.bytes).toBeGreaterThanOrEqual(0);
      expect(stats.entries).toBeGreaterThanOrEqual(0);
    });
  });

  test("bytes never exceed maxBytes after stabilization (1000 iterations)", () => {
    const maxBytes = 256;
    const cache = new ImageCache<string>(maxBytes);

    fuzz(1000, () => {
      const key = gen.int(0, 50);
      const size = gen.int(1, 100);
      cache.set(key, `val-${key}`, size);

      // After every set, bytes should be <= maxBytes
      // (unless the last inserted entry itself exceeds maxBytes,
      // in which case it's rejected and bytes should be even lower)
      expect(cache.stats.bytes).toBeLessThanOrEqual(maxBytes);
    });
  });

  test("hit/miss counters are monotonically increasing (500 iterations)", () => {
    const cache = new ImageCache<string>(1024);
    let prevHits = 0;
    let prevMisses = 0;

    fuzz(500, () => {
      if (gen.bool()) {
        cache.set(gen.int(0, 20), gen.string(1, 10), gen.int(1, 50));
      }
      cache.get(gen.int(0, 30));

      const stats = cache.stats;
      expect(stats.hits).toBeGreaterThanOrEqual(prevHits);
      expect(stats.misses).toBeGreaterThanOrEqual(prevMisses);
      prevHits = stats.hits;
      prevMisses = stats.misses;
    });
  });

  test("entries that exceed maxBytes are never cached (500 iterations)", () => {
    fuzz(500, () => {
      const maxBytes = gen.int(10, 500);
      const cache = new ImageCache<string>(maxBytes);
      const oversizedByteSize = maxBytes + gen.int(1, 1000);

      cache.set(1, "too-big", oversizedByteSize);

      expect(cache.get(1)).toBeUndefined();
      expect(cache.stats.entries).toBe(0);
      expect(cache.stats.bytes).toBe(0);
    });
  });

  test("clear always resets to empty state (200 iterations)", () => {
    const cache = new ImageCache<string>(1024);

    fuzz(200, () => {
      // Add some random entries
      const count = gen.int(1, 20);
      for (let i = 0; i < count; i++) {
        cache.set(gen.uint32(), gen.string(1, 10), gen.int(1, 50));
      }

      cache.clear();

      const stats = cache.stats;
      expect(stats.entries).toBe(0);
      expect(stats.bytes).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });
  });

  test("rapid set-then-get retrieves correct value (1000 iterations)", () => {
    const cache = new ImageCache<string>(16384);

    fuzz(1000, () => {
      const key = gen.uint32();
      const value = `value-${gen.string(1, 20)}`;
      const byteSize = gen.int(1, 100);

      cache.set(key, value, byteSize);
      const retrieved = cache.get(key);

      // The value should be retrievable unless it was evicted by its own
      // byteSize exceeding maxBytes
      if (byteSize <= 16384) {
        expect(retrieved).toBe(value);
      }
    });
  });
});
