// ── FNV-1a Hashing & Merkle Tree ────────────────────────────────────
//
// Two-level caching system for the render pipeline:
//
// 1. Buffer hashing (Phase 4 output dedup)
//    - FNV-1a with strided sampling (every 16th byte) for large buffers
//      At 30fps, even hashing a 320KB TouchStrip buffer with strided
//      JS sampling takes <1ms — no need for WASM acceleration.
//
// 2. FNV-1a (Fowler–Noll–Vo variant 1a)
//    - Fast, non-cryptographic 32-bit hash
//    - Used for: Merkle tree hashing, cache key mixing, small buffers
//    - XOR-then-multiply ordering gives better avalanche than FNV-1
//    - Math.imul() ensures correct 32-bit multiplication in JS
//    - `>>> 0` converts to unsigned 32-bit at the end
//
// 3. Merkle tree (per-VNode cached hashes)
//    - Each VNode caches its subtree hash in `_hash` / `_hashValid`
//    - When a node is mutated, `markDirty` invalidates `_hashValid`
//      up to the root — only the dirty path is re-hashed
//    - Cost: O(depth) for single-node mutation, not O(totalNodes)
//
//    VContainer
//    ├── VNode A (_hashValid=true)  ← reused, not recomputed
//    │   └── VNode B (_hashValid=true)
//    └── VNode C (_hashValid=false) ← mutated, rehash this path
//        └── VNode D (_hashValid=false)
//
// The combined Merkle hash + render config (width, height, DPR, format)
// forms the image cache key.  Two trees with identical structure but
// different render configs produce different cache keys.

import type { VNode, VContainer } from "@/reconciler/vnode";

// ── Constants ───────────────────────────────────────────────────────

const FNV_OFFSET_BASIS = 2166136261;
const FNV_PRIME = 16777619;

// ── Sentinel values for hashing typed nulls/undefined/NaN ───────────
// Unique 32-bit constants injected into the hash stream to distinguish
// between different JS value types.  Without these, `null`, `undefined`,
// and `false` would all hash to the same zero-length sequence.
// Values are chosen as ASCII-readable mnemonics for debuggability.

const SENTINEL_NULL = 0x4e554c4c; // "NULL" as u32
const SENTINEL_UNDEF = 0x554e4446; // "UNDF" as u32
const SENTINEL_NAN = 0x4e614e21; // "NaN!" as u32
const SENTINEL_TRUE = 0x54525545; // "TRUE" as u32
const SENTINEL_FALSE = 0x46414c53; // "FALS" as u32
const SENTINEL_ARRAY = 0x41525259; // "ARRY" as u32
const SENTINEL_OBJECT = 0x4f424a54; // "OBJT" as u32

// ── Low-Level Hash Primitives ───────────────────────────────────────

// Buffers larger than this threshold use the xxHash-wasm fast path
// (or JS strided FNV-1a fallback).  4 KB is well below the smallest
// useful raster (144×144×4 = 83 KB for a key image), so the fast path
// only activates for actual raster data, never for short strings or
// small props.
const STRIDE_THRESHOLD = 4096;

// Fallback constants for JS FNV-1a strided sampling (used before WASM
// is ready or if WASM fails to compile).
// Sample one full RGBA pixel out of every 4 pixels for large buffers.
const STRIDE = 16;

/**
 * Hash a raw byte buffer (Uint8Array or Buffer) or string.
 *
 * For buffers larger than {@link STRIDE_THRESHOLD} bytes, uses strided
 * FNV-1a sampling (every 16th byte) — at 30fps this adds <1ms even
 * for 320KB TouchStrip buffers.
 *
 * Strings and small buffers always use full byte-by-byte FNV-1a.
 */
export function fnv1a(input: string | Uint8Array | Buffer): number {
  let hash = FNV_OFFSET_BASIS;

  if (typeof input === "string") {
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, FNV_PRIME);
    }
  } else if (input.length > STRIDE_THRESHOLD) {
    // Strided FNV-1a: sample one full RGBA pixel out of every 4 pixels.
    // Mix in the total byte length first so buffers of different sizes
    // that happen to share sampled bytes still produce different hashes.
    hash = fnv1aU32(input.length, hash);
    for (let i = 0; i < input.length; i += STRIDE) {
      const end = Math.min(i + 4, input.length);
      for (let j = i; j < end; j++) {
        hash ^= input[j]!;
        hash = Math.imul(hash, FNV_PRIME);
      }
    }
  } else {
    for (let i = 0; i < input.length; i++) {
      hash ^= input[i]!;
      hash = Math.imul(hash, FNV_PRIME);
    }
  }

  return hash >>> 0;
}

/** Feed a string into a running FNV-1a hash. */
export function fnv1aString(str: string, hash: number): number {
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash;
}

/** Feed a uint32 value into a running FNV-1a hash (4 bytes, big-endian). */
export function fnv1aU32(value: number, hash: number): number {
  hash ^= (value >>> 24) & 0xff;
  hash = Math.imul(hash, FNV_PRIME);
  hash ^= (value >>> 16) & 0xff;
  hash = Math.imul(hash, FNV_PRIME);
  hash ^= (value >>> 8) & 0xff;
  hash = Math.imul(hash, FNV_PRIME);
  hash ^= value & 0xff;
  hash = Math.imul(hash, FNV_PRIME);
  return hash;
}

// ── Value Hashing ───────────────────────────────────────────────────
// Hash arbitrary JS values into a running hash.  Handles all prop types
// that appear in VNode trees (strings, numbers, booleans, arrays, plain
// objects).  Functions and Symbols are skipped — they don't affect visual
// output in this renderer (event handlers, refs, etc.).
//
// Depth-limited to MAX_HASH_DEPTH to prevent stack overflow on deeply
// nested style objects.  Object keys are sorted for deterministic hashing
// regardless of insertion order.

const MAX_HASH_DEPTH = 10;

/** Hash an arbitrary JS value into a running FNV-1a hash. */
export function hashValue(value: unknown, hash: number, depth = 0): number {
  if (depth > MAX_HASH_DEPTH) return hash;

  if (value === null) {
    return fnv1aU32(SENTINEL_NULL, hash);
  }

  if (value === undefined) {
    return fnv1aU32(SENTINEL_UNDEF, hash);
  }

  switch (typeof value) {
    case "string":
      return fnv1aString(value, hash);

    case "number":
      if (Number.isNaN(value)) {
        return fnv1aU32(SENTINEL_NAN, hash);
      }
      // Hash the string representation — deterministic for all finite numbers
      return fnv1aString(String(value), hash);

    case "boolean":
      return fnv1aU32(value ? SENTINEL_TRUE : SENTINEL_FALSE, hash);

    case "function":
    case "symbol":
      // Skip — functions/symbols don't affect visual output
      return hash;

    case "object": {
      if (Array.isArray(value)) {
        hash = fnv1aU32(SENTINEL_ARRAY, hash);
        hash = fnv1aU32(value.length, hash);
        for (let i = 0; i < value.length; i++) {
          hash = hashValue(value[i], hash, depth + 1);
        }
        return hash;
      }

      // Plain object — sort keys for deterministic hashing
      hash = fnv1aU32(SENTINEL_OBJECT, hash);
      const keys = Object.keys(value as Record<string, unknown>).sort();
      hash = fnv1aU32(keys.length, hash);
      for (const key of keys) {
        const v = (value as Record<string, unknown>)[key];
        if (typeof v === "function" || typeof v === "symbol") continue;
        hash = fnv1aString(key, hash);
        hash = hashValue(v, hash, depth + 1);
      }
      return hash;
    }

    default:
      // bigint, etc. — hash string representation
      return fnv1aString(String(value), hash);
  }
}

// ── Per-VNode Merkle Hash ───────────────────────────────────────────
// Each VNode caches its hash. Unchanged subtrees reuse cached hashes,
// giving O(depth) re-hash cost for single-node mutations instead of
// O(totalNodes).

/**
 * Compute (or return cached) Merkle hash for a single VNode.
 * The hash incorporates: type, text, props (sorted, functions skipped),
 * children count, and children hashes (recursive).
 */
export function computeHash(node: VNode): number {
  if (node._hashValid && node._hash !== undefined) {
    return node._hash;
  }

  let hash = FNV_OFFSET_BASIS;

  // Hash type
  hash = fnv1aString(node.type, hash);

  // Hash text content
  if (node.text !== undefined) {
    hash = fnv1aString(node.text, hash);
  }

  // Hash props (sorted keys for determinism, skip functions).
  // Reuse cached sorted key array when available — avoids
  // Object.keys().sort() on every hash for unchanged prop shapes.
  // The cache is invalidated in host-config.ts commitUpdate() when
  // props are replaced.
  const keys = (node._sortedPropKeys ??= Object.keys(node.props).sort());
  for (const key of keys) {
    const value = node.props[key];
    if (typeof value === "function" || typeof value === "symbol") continue;
    hash = fnv1aString(key, hash);
    hash = hashValue(value, hash);
  }

  // Hash children count (structural marker)
  hash = fnv1aU32(node.children.length, hash);

  // Hash children (recursive — uses cached hashes for clean subtrees)
  for (const child of node.children) {
    hash = fnv1aU32(computeHash(child), hash);
  }

  node._hash = hash >>> 0;
  node._hashValid = true;
  return node._hash;
}

/**
 * Compute the Merkle hash for an entire VContainer tree.
 * Returns 0 for empty containers.
 */
export function computeTreeHash(container: VContainer): number {
  if (container.children.length === 0) return 0;

  let hash = FNV_OFFSET_BASIS;
  hash = fnv1aU32(container.children.length, hash);

  for (const child of container.children) {
    hash = fnv1aU32(computeHash(child), hash);
  }

  return hash >>> 0;
}

// ── Cache Key with Render Config ────────────────────────────────────
// Incorporates render-config factors that affect pixel output but aren't
// part of the VNode tree.  Two identical trees rendered at different
// sizes or DPRs produce different images, so these must be in the key.
// DPR is multiplied by 100 and rounded to avoid floating-point hash
// instability (e.g. 1.0000000001 vs 1.0).

export function computeCacheKey(
  treeHash: number,
  width: number,
  height: number,
  dpr: number,
  format: string,
): number {
  let key = treeHash;
  key = fnv1aU32(width, key);
  key = fnv1aU32(height, key);
  key = fnv1aU32(Math.round(dpr * 100), key);
  key = fnv1aString(format, key);
  return key >>> 0;
}

// ── TouchStrip Segment Cache Key ─────────────────────────────────────
// Extends the standard cache key with the sorted column list.
// Different column configurations at the same total width can produce
// different segment URI sets (e.g. columns [0,1,2,3] vs [0,1,3] both
// yield width=800 but different active segments), so the column layout
// must be part of the cache key.

export function computeTouchStripSegmentCacheKey(
  treeHash: number,
  width: number,
  height: number,
  dpr: number,
  columns: number[],
): number {
  let key = computeCacheKey(treeHash, width, height, dpr, "png");
  key = fnv1aU32(columns.length, key);
  for (const col of columns) {
    key = fnv1aU32(col, key);
  }
  return key >>> 0;
}
