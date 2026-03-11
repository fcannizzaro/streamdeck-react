// ── FNV-1a Hashing & Merkle Tree ────────────────────────────────────
//
// Two-level caching system for the render pipeline:
//
// 1. Buffer hashing (Phase 4 output dedup)
//    - Primary: xxHash-wasm — WASM-accelerated 32-bit xxHash
//      Hashes the full raster buffer (~320 KB for touchstrip) in native
//      code, significantly faster than any JS loop with better
//      avalanche/distribution than FNV-1a.
//    - Fallback: FNV-1a with strided sampling (every 16th byte)
//      Used during startup before WASM has compiled (~1ms), or if
//      WASM is unavailable in the runtime.
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

import xxhashInit from "xxhash-wasm";
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

// ── xxHash-wasm Accelerator ─────────────────────────────────────────
//
// xxHash-wasm provides a WASM-compiled xxHash implementation that hashes
// full raster buffers (~320 KB for touchstrip, ~83 KB for keys) faster
// than any JS loop — even a strided one.  The WASM module compiles
// asynchronously (~1ms on Node.js) so there's a brief window at startup
// where the JS FNV-1a fallback is used.
//
//   Module imported → initBufferHasher() fires (async)
//     ↓ ~1ms
//   WASM compiled → bufferHashFn set → fnv1a() uses xxHash
//
// The `h32Raw()` function is a synchronous, zero-allocation hash of a
// Uint8Array that returns a u32.  Since Buffer extends Uint8Array, it
// works directly without conversion.

/** @internal WASM-accelerated buffer hash function, null before init. */
let bufferHashFn: ((input: Uint8Array, seed?: number) => number) | null = null;
let xxHashInitPromise: Promise<void> | null = null;

/**
 * Initialize the xxHash-wasm module.  Call is idempotent — subsequent
 * calls return the same promise.  Resolves once `fnv1a()` will use the
 * WASM fast path for large buffers.
 */
export function initBufferHasher(): Promise<void> {
  if (xxHashInitPromise != null) return xxHashInitPromise;
  xxHashInitPromise = xxhashInit()
    .then((api) => {
      bufferHashFn = api.h32Raw;
    })
    .catch(() => {
      // WASM unavailable — fnv1a() will continue using JS strided sampling.
    });
  return xxHashInitPromise;
}

/** Reset the xxHash singleton — for testing only. */
export function resetBufferHasher(): void {
  bufferHashFn = null;
  xxHashInitPromise = null;
}

// Fire-and-forget: start WASM compilation when module is first imported.
// By the time the first render cycle calls fnv1a() for a large buffer,
// WASM will have compiled.
void initBufferHasher();

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
 * For buffers larger than {@link STRIDE_THRESHOLD} bytes:
 * - **Primary path**: xxHash-wasm `h32Raw()` — hashes the entire buffer
 *   in native WASM code.  Faster than JS strided sampling even for
 *   320 KB touchstrip frames, with superior hash distribution.
 * - **Fallback path**: FNV-1a with strided sampling (every 16th byte)
 *   when WASM hasn't compiled yet (startup) or is unavailable.
 *
 * Strings and small buffers always use JS FNV-1a (fast enough at those
 * sizes, and avoids the overhead of calling into WASM for tiny inputs).
 */
export function fnv1a(input: string | Uint8Array | Buffer): number {
  let hash = FNV_OFFSET_BASIS;

  if (typeof input === "string") {
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, FNV_PRIME);
    }
  } else if (input.length > STRIDE_THRESHOLD) {
    // Fast path: xxHash-wasm hashes the full buffer in native WASM —
    // faster than JS strided FNV-1a even for 320 KB touchstrip frames,
    // with better hash distribution (no sampling artifacts).
    if (bufferHashFn != null) {
      return bufferHashFn(input);
    }
    // Fallback: strided FNV-1a when WASM hasn't initialized yet.
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

// ── Native Touchstrip Cache Key ───────────────────────────────────────
// Extends the standard cache key with the sorted column list.
// Different column configurations at the same total width can produce
// different segment URI sets (e.g. columns [0,1,2,3] vs [0,1,3] both
// yield width=800 but different active segments), so the column layout
// must be part of the cache key.

export function computeNativeTouchstripCacheKey(
  treeHash: number,
  width: number,
  height: number,
  dpr: number,
  format: string,
  columns: number[],
): number {
  let key = computeCacheKey(treeHash, width, height, dpr, format);
  key = fnv1aU32(columns.length, key);
  for (const col of columns) {
    key = fnv1aU32(col, key);
  }
  return key >>> 0;
}
