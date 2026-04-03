// ── Fuzz Testing Utilities ──────────────────────────────────────────
//
// Lightweight property-based / fuzz testing primitives for Bun's test
// runner.  These generators produce random inputs across the full
// value space, including edge cases that developers rarely test
// manually (NaN, -0, MAX_SAFE_INTEGER, empty strings, surrogates,
// deeply nested objects, etc.).
//
// Why not a library like fast-check?
//   The project avoids non-essential devDependencies.  These ~200 lines
//   cover the generation patterns needed for the library's attack
//   surface (hashing, caching, buffer ops, SVG serialization) without
//   adding a dependency.
//
// Usage:
//
//   import { fuzz, gen } from "@/test-utils/fuzz";
//
//   test("fnv1a never throws", () => {
//     fuzz(1000, () => {
//       const input = gen.string();
//       expect(() => fnv1a(input)).not.toThrow();
//     });
//   });

// ── Seeded PRNG ─────────────────────────────────────────────────────
// Mulberry32: fast 32-bit PRNG with deterministic output for a given
// seed.  Determinism is critical for fuzz tests — a failing seed can
// be recorded and replayed to reproduce the exact failure.

let _seed = Date.now() ^ (Math.random() * 0xffffffff);

/** Set the PRNG seed for deterministic replay. */
export function setSeed(seed: number): void {
  _seed = seed;
}

/** Get the current seed (log this on failure for replay). */
export function getSeed(): number {
  return _seed;
}

function mulberry32(): number {
  _seed |= 0;
  _seed = (_seed + 0x6d2b79f5) | 0;
  let t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ── Core Generators ─────────────────────────────────────────────────

function randomInt(min: number, max: number): number {
  return Math.floor(mulberry32() * (max - min + 1)) + min;
}

function randomFloat(min: number, max: number): number {
  return mulberry32() * (max - min) + min;
}

function pick<T>(arr: readonly T[]): T {
  return arr[randomInt(0, arr.length - 1)]!;
}

// ── String Generator ────────────────────────────────────────────────
// Produces strings from multiple character classes including ASCII,
// Unicode BMP, surrogates, control characters, and special SVG/HTML
// characters that could trigger injection issues.

const CHAR_POOLS = {
  ascii: () => String.fromCharCode(randomInt(32, 126)),
  control: () => String.fromCharCode(randomInt(0, 31)),
  unicode: () => String.fromCharCode(randomInt(0x0100, 0xffff)),
  surrogate: () => String.fromCharCode(randomInt(0xd800, 0xdfff)),
  svgSpecial: () => pick(["<", ">", "&", '"', "'", "/", "\\", "\0", "\n", "\r", "\t"]),
  pathTraversal: () => pick(["../", "..\\", "./", ".\\", "/", "\\", "\0"]),
  emoji: () => pick(["😀", "🎉", "🔥", "💀", "🏴‍☠️", "👨‍👩‍👧‍👦"]),
} as const;

function randomString(minLen = 0, maxLen = 100): string {
  const len = randomInt(minLen, maxLen);
  let result = "";
  for (let i = 0; i < len; i++) {
    const pool = pick(Object.keys(CHAR_POOLS)) as keyof typeof CHAR_POOLS;
    result += CHAR_POOLS[pool]();
  }
  return result;
}

// ── Number Generator ────────────────────────────────────────────────
// Includes edge cases: NaN, Infinity, -Infinity, -0, MAX_SAFE_INTEGER,
// MIN_SAFE_INTEGER, MAX_VALUE, MIN_VALUE, epsilon.

const EDGE_NUMBERS = [
  0,
  -0,
  1,
  -1,
  NaN,
  Infinity,
  -Infinity,
  Number.MAX_SAFE_INTEGER,
  Number.MIN_SAFE_INTEGER,
  Number.MAX_VALUE,
  Number.MIN_VALUE,
  Number.EPSILON,
  0.1 + 0.2, // floating point imprecision: 0.30000000000000004
  2 ** 32,
  2 ** 32 - 1,
  -(2 ** 31),
  2 ** 31 - 1,
] as const;

function randomNumber(): number {
  if (mulberry32() < 0.3) {
    return pick(EDGE_NUMBERS);
  }
  return randomFloat(-1e15, 1e15);
}

function randomUint32(): number {
  return (mulberry32() * 0xffffffff) >>> 0;
}

function randomInt32(): number {
  return (mulberry32() * 0xffffffff) | 0;
}

// ── Buffer Generator ────────────────────────────────────────────────

function randomBuffer(minSize = 0, maxSize = 16384): Uint8Array {
  const size = randomInt(minSize, maxSize);
  const buf = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    buf[i] = randomInt(0, 255);
  }
  return buf;
}

function randomUint8Array(minSize = 0, maxSize = 16384): Uint8Array {
  const size = randomInt(minSize, maxSize);
  const arr = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    arr[i] = randomInt(0, 255);
  }
  return arr;
}

// ── Arbitrary Value Generator ───────────────────────────────────────
// Produces values from the full JS value space, optionally with nesting.

function randomValue(maxDepth = 3): unknown {
  if (maxDepth <= 0) {
    return pick([randomString(0, 20), randomNumber(), true, false, null, undefined]);
  }

  const kind = randomInt(0, 9);
  switch (kind) {
    case 0:
      return randomString(0, 50);
    case 1:
      return randomNumber();
    case 2:
      return mulberry32() > 0.5;
    case 3:
      return null;
    case 4:
      return undefined;
    case 5:
      return () => {};
    case 6:
      return Symbol(randomString(0, 10));
    case 7: {
      // Array
      const len = randomInt(0, 8);
      return Array.from({ length: len }, () => randomValue(maxDepth - 1));
    }
    case 8: {
      // Plain object
      const keys = randomInt(0, 8);
      const obj: Record<string, unknown> = {};
      for (let i = 0; i < keys; i++) {
        obj[randomString(1, 20)] = randomValue(maxDepth - 1);
      }
      return obj;
    }
    case 9:
      return BigInt(randomInt(-1000, 1000));
    default:
      return null;
  }
}

// ── Props Generator (for VNode props) ───────────────────────────────

function randomProps(): Record<string, unknown> {
  const count = randomInt(0, 10);
  const props: Record<string, unknown> = {};
  for (let i = 0; i < count; i++) {
    const key = randomString(1, 30);
    props[key] = randomValue(2);
  }
  return props;
}

// ── Public API ──────────────────────────────────────────────────────

export const gen = {
  string: randomString,
  number: randomNumber,
  uint32: randomUint32,
  int32: randomInt32,
  buffer: randomBuffer,
  uint8Array: randomUint8Array,
  value: randomValue,
  props: randomProps,
  int: randomInt,
  float: randomFloat,
  pick,
  bool: () => mulberry32() > 0.5,
} as const;

/**
 * Run a fuzz test body `iterations` times with random inputs.
 * Logs the seed on failure for deterministic replay.
 *
 * @example
 * ```ts
 * test("fnv1a never throws on random strings", () => {
 *   fuzz(1000, () => {
 *     const s = gen.string();
 *     expect(() => fnv1a(s)).not.toThrow();
 *   });
 * });
 * ```
 */
export function fuzz(iterations: number, body: (iteration: number) => void): void {
  const startSeed = _seed;
  for (let i = 0; i < iterations; i++) {
    try {
      body(i);
    } catch (err) {
      const msg =
        err instanceof Error
          ? `Fuzz failure at iteration ${i} (seed=${startSeed}):\n${err.message}`
          : `Fuzz failure at iteration ${i} (seed=${startSeed}): ${String(err)}`;
      const wrapped = new Error(msg);
      (wrapped as unknown as { cause: unknown }).cause = err;
      throw wrapped;
    }
  }
}
