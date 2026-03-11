import { describe, expect, test } from "bun:test";
import {
  fnv1a,
  fnv1aString,
  fnv1aU32,
  hashValue,
  computeHash,
  computeTreeHash,
  computeCacheKey,
} from "@/render/cache";
import { createVNode, createTextVNode, createVContainer } from "@/reconciler/vnode";

// ── FNV-1a Primitives ───────────────────────────────────────────────

describe("fnv1a", () => {
  test("produces a consistent hash for a string", () => {
    const hash1 = fnv1a("hello");
    const hash2 = fnv1a("hello");
    expect(hash1).toBe(hash2);
  });

  test("different strings produce different hashes", () => {
    expect(fnv1a("hello")).not.toBe(fnv1a("world"));
  });

  test("empty string produces the FNV offset basis", () => {
    // FNV_OFFSET_BASIS = 2166136261
    expect(fnv1a("")).toBe(2166136261);
  });

  test("works with Uint8Array", () => {
    const data = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    const hash = fnv1a(data);
    expect(typeof hash).toBe("number");
    expect(hash).toBeGreaterThan(0);
  });

  test("works with Buffer", () => {
    const buf = Buffer.from("test");
    const hash = fnv1a(buf);
    expect(typeof hash).toBe("number");
  });

  test("returns unsigned 32-bit integer", () => {
    const hash = fnv1a("some test string");
    expect(hash).toBeGreaterThanOrEqual(0);
    expect(hash).toBeLessThanOrEqual(0xffffffff);
  });

  test("uses strided sampling for large buffers (>4KB)", () => {
    const large = new Uint8Array(8192);
    large.fill(42);
    const hash1 = fnv1a(large);
    const hash2 = fnv1a(large);
    expect(hash1).toBe(hash2);
  });

  test("strided sampling distinguishes buffers of different lengths", () => {
    const a = new Uint8Array(8192).fill(0);
    const b = new Uint8Array(8193).fill(0);
    expect(fnv1a(a)).not.toBe(fnv1a(b));
  });

  test("strided sampling detects changes at stride-aligned offsets", () => {
    const a = new Uint8Array(8192).fill(0);
    const b = new Uint8Array(8192).fill(0);
    b[4096] = 255; // stride=16, offset 4096 is sample-aligned
    expect(fnv1a(a)).not.toBe(fnv1a(b));
  });

  test("strided sampling detects changes within the sampled RGBA pixel", () => {
    const a = new Uint8Array(8192).fill(0);
    const b = new Uint8Array(8192).fill(0);
    b[4099] = 255; // same sampled pixel, different channel
    expect(fnv1a(a)).not.toBe(fnv1a(b));
  });

  test("small buffers below threshold hash every byte", () => {
    // Two 100-byte buffers differing at offset 1 (non-stride-aligned
    // but below threshold, so every byte is hashed)
    const a = new Uint8Array(100).fill(0);
    const b = new Uint8Array(100).fill(0);
    b[1] = 255;
    expect(fnv1a(a)).not.toBe(fnv1a(b));
  });
});

describe("fnv1aString", () => {
  test("produces a different hash than the base", () => {
    const base = 2166136261; // FNV_OFFSET_BASIS
    const result = fnv1aString("hello", base);
    expect(result).not.toBe(base);
  });

  test("same input and base produce consistent results", () => {
    const base = 2166136261;
    const a = fnv1aString("test", base);
    const b = fnv1aString("test", base);
    expect(a).toBe(b);
  });

  test("different strings produce different hashes", () => {
    const base = 2166136261;
    expect(fnv1aString("hello", base)).not.toBe(fnv1aString("world", base));
  });
});

describe("fnv1aU32", () => {
  test("feeds a 32-bit value into a running hash", () => {
    const hash1 = fnv1aU32(42, 2166136261);
    const hash2 = fnv1aU32(42, 2166136261);
    expect(hash1).toBe(hash2);
  });

  test("different values produce different hashes", () => {
    const base = 2166136261;
    expect(fnv1aU32(1, base)).not.toBe(fnv1aU32(2, base));
  });
});

// ── hashValue ───────────────────────────────────────────────────────

describe("hashValue", () => {
  const BASE = 2166136261;

  test("hashes null with sentinel", () => {
    const hash = hashValue(null, BASE);
    expect(hash).not.toBe(BASE);
  });

  test("hashes undefined with sentinel", () => {
    const hash = hashValue(undefined, BASE);
    expect(hash).not.toBe(BASE);
  });

  test("null and undefined produce different hashes", () => {
    expect(hashValue(null, BASE)).not.toBe(hashValue(undefined, BASE));
  });

  test("hashes strings", () => {
    const a = hashValue("hello", BASE);
    const b = hashValue("world", BASE);
    expect(a).not.toBe(b);
  });

  test("hashes numbers", () => {
    const a = hashValue(42, BASE);
    const b = hashValue(43, BASE);
    expect(a).not.toBe(b);
  });

  test("NaN produces a specific sentinel hash", () => {
    const nanHash = hashValue(NaN, BASE);
    const numHash = hashValue(0, BASE);
    expect(nanHash).not.toBe(numHash);
  });

  test("hashes booleans with distinct sentinels", () => {
    const t = hashValue(true, BASE);
    const f = hashValue(false, BASE);
    expect(t).not.toBe(f);
  });

  test("skips functions (returns hash unchanged)", () => {
    const hash = hashValue(() => {}, BASE);
    expect(hash).toBe(BASE);
  });

  test("skips symbols (returns hash unchanged)", () => {
    const hash = hashValue(Symbol("test"), BASE);
    expect(hash).toBe(BASE);
  });

  test("hashes arrays including length", () => {
    const a = hashValue([1, 2, 3], BASE);
    const b = hashValue([1, 2], BASE);
    expect(a).not.toBe(b);
  });

  test("hashes objects with sorted keys", () => {
    const a = hashValue({ b: 2, a: 1 }, BASE);
    const b = hashValue({ a: 1, b: 2 }, BASE);
    expect(a).toBe(b); // same content, different insertion order
  });

  test("different objects produce different hashes", () => {
    const a = hashValue({ x: 1 }, BASE);
    const b = hashValue({ x: 2 }, BASE);
    expect(a).not.toBe(b);
  });

  test("respects MAX_HASH_DEPTH", () => {
    // Deeply nested object — should not cause stack overflow
    let obj: unknown = "leaf";
    for (let i = 0; i < 20; i++) {
      obj = { nested: obj };
    }
    const hash = hashValue(obj, BASE);
    expect(typeof hash).toBe("number");
  });
});

// ── computeHash (VNode Merkle hash) ─────────────────────────────────

describe("computeHash", () => {
  test("same node produces consistent hash", () => {
    const node = createVNode("div", { color: "red" });
    const hash1 = computeHash(node);
    const hash2 = computeHash(node);
    expect(hash1).toBe(hash2);
  });

  test("caches hash after first computation", () => {
    const node = createVNode("div", { color: "red" });
    computeHash(node);

    expect(node._hashValid).toBe(true);
    expect(node._hash).toBeDefined();
  });

  test("different types produce different hashes", () => {
    const div = createVNode("div", {});
    const span = createVNode("span", {});
    expect(computeHash(div)).not.toBe(computeHash(span));
  });

  test("different props produce different hashes", () => {
    const a = createVNode("div", { color: "red" });
    const b = createVNode("div", { color: "blue" });
    expect(computeHash(a)).not.toBe(computeHash(b));
  });

  test("text nodes hash their text content", () => {
    const a = createTextVNode("Hello");
    const b = createTextVNode("World");
    expect(computeHash(a)).not.toBe(computeHash(b));
  });

  test("children affect parent hash", () => {
    const withChild = createVNode("div", {});
    withChild.children.push(createVNode("span", {}));

    const withoutChild = createVNode("div", {});

    expect(computeHash(withChild)).not.toBe(computeHash(withoutChild));
  });

  test("returns cached hash when _hashValid is true", () => {
    const node = createVNode("div", {});
    node._hash = 999;
    node._hashValid = true;

    expect(computeHash(node)).toBe(999);
  });

  test("reuses cached sorted prop keys across hash recomputations", () => {
    const node = createVNode("div", { b: 2, a: 1 });

    computeHash(node);
    expect(node._sortedPropKeys).toEqual(["a", "b"]);

    node._hashValid = false;
    const cachedKeys = node._sortedPropKeys;
    computeHash(node);

    expect(node._sortedPropKeys).toBe(cachedKeys);
  });

  test("function props are skipped in hash", () => {
    const a = createVNode("div", { onClick: () => {} });
    const b = createVNode("div", { onClick: () => {} });
    const c = createVNode("div", {});

    // Two nodes with different function refs should hash the same as one without
    expect(computeHash(a)).toBe(computeHash(b));
    expect(computeHash(a)).toBe(computeHash(c));
  });
});

// ── computeTreeHash ─────────────────────────────────────────────────

describe("computeTreeHash", () => {
  test("returns 0 for empty container", () => {
    const container = createVContainer(() => {});
    container.children = [];
    expect(computeTreeHash(container)).toBe(0);
  });

  test("produces consistent hash for same tree", () => {
    const container = createVContainer(() => {});
    container.children = [createVNode("div", { color: "red" })];

    const hash1 = computeTreeHash(container);
    const hash2 = computeTreeHash(container);
    expect(hash1).toBe(hash2);
  });

  test("different trees produce different hashes", () => {
    const c1 = createVContainer(() => {});
    c1.children = [createVNode("div", {})];

    const c2 = createVContainer(() => {});
    c2.children = [createVNode("span", {})];

    expect(computeTreeHash(c1)).not.toBe(computeTreeHash(c2));
  });
});

// ── computeCacheKey ─────────────────────────────────────────────────

describe("computeCacheKey", () => {
  test("same inputs produce same key", () => {
    const key1 = computeCacheKey(12345, 144, 144, 1, "png");
    const key2 = computeCacheKey(12345, 144, 144, 1, "png");
    expect(key1).toBe(key2);
  });

  test("different tree hashes produce different keys", () => {
    const a = computeCacheKey(111, 144, 144, 1, "png");
    const b = computeCacheKey(222, 144, 144, 1, "png");
    expect(a).not.toBe(b);
  });

  test("different dimensions produce different keys", () => {
    const a = computeCacheKey(111, 144, 144, 1, "png");
    const b = computeCacheKey(111, 200, 100, 1, "png");
    expect(a).not.toBe(b);
  });

  test("different DPR produces different keys", () => {
    const a = computeCacheKey(111, 144, 144, 1, "png");
    const b = computeCacheKey(111, 144, 144, 2, "png");
    expect(a).not.toBe(b);
  });

  test("different formats produce different keys", () => {
    const a = computeCacheKey(111, 144, 144, 1, "png");
    const b = computeCacheKey(111, 144, 144, 1, "webp");
    expect(a).not.toBe(b);
  });

  test("returns unsigned 32-bit integer", () => {
    const key = computeCacheKey(99999, 800, 480, 2, "webp");
    expect(key).toBeGreaterThanOrEqual(0);
    expect(key).toBeLessThanOrEqual(0xffffffff);
  });
});
