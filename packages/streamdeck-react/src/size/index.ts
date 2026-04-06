// ── Size Calculation Utility ─────────────────────────────────────────
//
// Provides percentage-based and fractional size calculations relative
// to Stream Deck surface dimensions.
//
// Stream Deck surfaces have fixed pixel dimensions:
//   Keys:           144×144  (square)
//   Dials/Encoders: 200×100  (landscape)
//   Touch strip:    800×100  (wide landscape, full strip)
//   Touch segment:  200×100  (per-encoder segment)
//
// Users frequently need to calculate proportional sizes for responsive
// layouts that work across different surfaces.  Without this utility,
// manual arithmetic with magic numbers is required everywhere.
//
// Two entry points:
//   calcSize(width, height)  — standalone, no React context needed
//   useSize()                — hook, reads canvas dimensions from context

// ── Size Helper Interface ───────────────────────────────────────────

export interface SizeHelper {
  /** Raw canvas width in pixels. */
  readonly width: number;
  /** Raw canvas height in pixels. */
  readonly height: number;
  /** Minimum of width and height. Useful for sizing circular elements. */
  readonly min: number;
  /** Maximum of width and height. */
  readonly max: number;
  /** True if width equals height (e.g., key surfaces: 144×144). */
  readonly square: boolean;
  /** True if width is greater than height (e.g., dials: 200×100). */
  readonly landscape: boolean;
  /** True if height is greater than width. */
  readonly portrait: boolean;
  /** Aspect ratio (width / height). */
  readonly aspectRatio: number;
  /** Calculate a percentage of the canvas width, rounded to nearest integer. */
  w(percent: number): number;
  /** Calculate a percentage of the canvas height, rounded to nearest integer. */
  h(percent: number): number;
  /** Calculate a percentage of the minimum dimension, rounded to nearest integer. */
  minP(percent: number): number;
  /** Calculate a percentage of the maximum dimension, rounded to nearest integer. */
  maxP(percent: number): number;
  /**
   * Scale a base pixel value proportionally to canvas size.
   * Uses the minimum dimension as the reference axis so elements
   * fit within both width and height.
   *
   * The reference base is 144 (standard key size).  A value of 16
   * on a 144×144 key returns 16.  On a 200×100 dial, it returns
   * Math.round(16 * 100/144) = 11.
   *
   * @param basePx - The pixel value designed for a 144×144 key.
   * @param referenceSize - Reference dimension (default: 144).
   */
  scale(basePx: number, referenceSize?: number): number;
}

// ── Standalone Factory ──────────────────────────────────────────────

/**
 * Create a size helper for the given pixel dimensions.
 *
 * @example
 * ```ts
 * const s = calcSize(144, 144);
 * s.w(50)    // 72
 * s.square   // true
 * s.scale(16) // 16
 * ```
 */
export function calcSize(width: number, height: number): SizeHelper {
  const min = Math.min(width, height);
  const max = Math.max(width, height);

  return {
    width,
    height,
    min,
    max,
    square: width === height,
    landscape: width > height,
    portrait: height > width,
    aspectRatio: height > 0 ? width / height : 0,

    w(percent: number): number {
      return Math.round((width * percent) / 100);
    },

    h(percent: number): number {
      return Math.round((height * percent) / 100);
    },

    minP(percent: number): number {
      return Math.round((min * percent) / 100);
    },

    maxP(percent: number): number {
      return Math.round((max * percent) / 100);
    },

    scale(basePx: number, referenceSize = 144): number {
      if (referenceSize <= 0) return basePx;
      return Math.round((basePx * min) / referenceSize);
    },
  };
}
