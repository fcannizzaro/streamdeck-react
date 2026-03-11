import { describe, expect, test } from "bun:test";
import { ImageCache } from "@/render/image-cache";

describe("ImageCache", () => {
  test("returns undefined for a cache miss", () => {
    const cache = new ImageCache<string>(1024);
    expect(cache.get(1)).toBeUndefined();
  });

  test("stores and retrieves a value", () => {
    const cache = new ImageCache<string>(1024);
    cache.set(1, "hello", 5);
    expect(cache.get(1)).toBe("hello");
  });

  test("tracks hits and misses in stats", () => {
    const cache = new ImageCache<string>(1024);
    cache.set(1, "a", 10);

    cache.get(1); // hit
    cache.get(1); // hit
    cache.get(2); // miss

    const stats = cache.stats;
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(1);
    expect(stats.entries).toBe(1);
    expect(stats.bytes).toBe(10);
  });

  test("evicts LRU entries when over budget", () => {
    const cache = new ImageCache<string>(100);

    cache.set(1, "first", 60);
    cache.set(2, "second", 60);

    // First entry should be evicted (LRU)
    expect(cache.get(1)).toBeUndefined();
    expect(cache.get(2)).toBe("second");
  });

  test("promotes entry to MRU on get", () => {
    const cache = new ImageCache<string>(100);

    cache.set(1, "a", 40); // oldest
    cache.set(2, "b", 40); // middle

    // Access key 1 to promote it to MRU
    cache.get(1);

    // Adding a new entry that exceeds budget should evict key 2 (LRU), not key 1
    cache.set(3, "c", 40);

    expect(cache.get(1)).toBe("a");
    expect(cache.get(2)).toBeUndefined();
    expect(cache.get(3)).toBe("c");
  });

  test("updates existing entry in-place", () => {
    const cache = new ImageCache<string>(1024);

    cache.set(1, "old", 10);
    cache.set(1, "new", 20);

    expect(cache.get(1)).toBe("new");
    expect(cache.stats.entries).toBe(1);
    expect(cache.stats.bytes).toBe(20);
  });

  test("does not cache entries larger than maxBytes", () => {
    const cache = new ImageCache<string>(50);

    cache.set(1, "too-large", 100);

    expect(cache.get(1)).toBeUndefined();
    expect(cache.stats.entries).toBe(0);
    expect(cache.stats.bytes).toBe(0);
  });

  test("clear resets all entries and stats", () => {
    const cache = new ImageCache<string>(1024);
    cache.set(1, "a", 10);
    cache.set(2, "b", 20);
    cache.get(1);
    cache.get(99); // miss

    cache.clear();

    // Verify stats are reset
    const stats = cache.stats;
    expect(stats.entries).toBe(0);
    expect(stats.bytes).toBe(0);
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);

    // Entries should no longer be retrievable
    expect(cache.get(1)).toBeUndefined();
    expect(cache.get(2)).toBeUndefined();
  });

  test("maxBytes is reflected in stats", () => {
    const cache = new ImageCache<string>(2048);
    expect(cache.stats.maxBytes).toBe(2048);
  });

  test("evicts multiple LRU entries to fit new entry", () => {
    const cache = new ImageCache<string>(100);

    cache.set(1, "a", 30);
    cache.set(2, "b", 30);
    cache.set(3, "c", 30);

    // Inserting a 50-byte entry should evict entries 1 and 2
    cache.set(4, "d", 50);

    expect(cache.get(1)).toBeUndefined();
    expect(cache.get(2)).toBeUndefined();
    expect(cache.get(3)).toBe("c");
    expect(cache.get(4)).toBe("d");
  });

  test("works with Buffer values", () => {
    const cache = new ImageCache<Buffer>(1024);
    const buf = Buffer.from([1, 2, 3, 4]);

    cache.set(42, buf, buf.length);
    expect(cache.get(42)).toBe(buf);
  });

  test("single entry cache evicts on second set", () => {
    const cache = new ImageCache<string>(10);

    cache.set(1, "a", 10);
    expect(cache.get(1)).toBe("a");

    cache.set(2, "b", 10);
    expect(cache.get(1)).toBeUndefined();
    expect(cache.get(2)).toBe("b");
  });
});
