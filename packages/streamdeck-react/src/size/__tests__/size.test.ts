import { describe, expect, test } from "bun:test";
import { calcSize } from "@/size/index";

describe("calcSize", () => {
  // ── Key surface (144×144 — square) ────────────────────────────

  describe("key surface (144×144)", () => {
    const s = calcSize(144, 144);

    test("raw dimensions", () => {
      expect(s.width).toBe(144);
      expect(s.height).toBe(144);
    });

    test("min/max", () => {
      expect(s.min).toBe(144);
      expect(s.max).toBe(144);
    });

    test("orientation flags", () => {
      expect(s.square).toBe(true);
      expect(s.landscape).toBe(false);
      expect(s.portrait).toBe(false);
    });

    test("aspect ratio", () => {
      expect(s.aspectRatio).toBe(1);
    });

    test("w() percentage", () => {
      expect(s.w(50)).toBe(72);
      expect(s.w(100)).toBe(144);
      expect(s.w(0)).toBe(0);
      expect(s.w(25)).toBe(36);
      expect(s.w(33)).toBe(48); // 144 * 0.33 = 47.52 → 48
    });

    test("h() percentage", () => {
      expect(s.h(50)).toBe(72);
      expect(s.h(100)).toBe(144);
    });

    test("minP() percentage", () => {
      expect(s.minP(50)).toBe(72);
    });

    test("maxP() percentage", () => {
      expect(s.maxP(50)).toBe(72);
    });

    test("scale() with default reference", () => {
      // 144/144 ratio = 1.0, so scale(16) = 16
      expect(s.scale(16)).toBe(16);
      expect(s.scale(24)).toBe(24);
    });
  });

  // ── Dial surface (200×100 — landscape) ────────────────────────

  describe("dial surface (200×100)", () => {
    const s = calcSize(200, 100);

    test("raw dimensions", () => {
      expect(s.width).toBe(200);
      expect(s.height).toBe(100);
    });

    test("min/max", () => {
      expect(s.min).toBe(100);
      expect(s.max).toBe(200);
    });

    test("orientation flags", () => {
      expect(s.square).toBe(false);
      expect(s.landscape).toBe(true);
      expect(s.portrait).toBe(false);
    });

    test("aspect ratio", () => {
      expect(s.aspectRatio).toBe(2);
    });

    test("w() percentage", () => {
      expect(s.w(50)).toBe(100);
      expect(s.w(25)).toBe(50);
    });

    test("h() percentage", () => {
      expect(s.h(50)).toBe(50);
      expect(s.h(100)).toBe(100);
    });

    test("scale() proportional to min dimension", () => {
      // min=100, reference=144 → ratio = 100/144 ≈ 0.694
      // scale(16) = Math.round(16 * 100/144) = Math.round(11.11) = 11
      expect(s.scale(16)).toBe(11);
      // scale(24) = Math.round(24 * 100/144) = Math.round(16.67) = 17
      expect(s.scale(24)).toBe(17);
    });

    test("scale() with custom reference", () => {
      // scale(16, 200) = Math.round(16 * 100/200) = Math.round(8) = 8
      expect(s.scale(16, 200)).toBe(8);
    });
  });

  // ── Touch strip (800×100 — wide landscape) ────────────────────

  describe("touch strip (800×100)", () => {
    const s = calcSize(800, 100);

    test("raw dimensions", () => {
      expect(s.width).toBe(800);
      expect(s.height).toBe(100);
    });

    test("min/max", () => {
      expect(s.min).toBe(100);
      expect(s.max).toBe(800);
    });

    test("orientation flags", () => {
      expect(s.square).toBe(false);
      expect(s.landscape).toBe(true);
      expect(s.portrait).toBe(false);
    });

    test("aspect ratio", () => {
      expect(s.aspectRatio).toBe(8);
    });

    test("w() percentage", () => {
      expect(s.w(25)).toBe(200); // one encoder segment
      expect(s.w(50)).toBe(400);
    });
  });

  // ── Edge cases ────────────────────────────────────────────────

  describe("edge cases", () => {
    test("zero dimensions", () => {
      const s = calcSize(0, 0);
      expect(s.min).toBe(0);
      expect(s.max).toBe(0);
      expect(s.square).toBe(true);
      expect(s.aspectRatio).toBe(0);
      expect(s.w(50)).toBe(0);
      expect(s.h(50)).toBe(0);
    });

    test("scale with zero reference returns basePx", () => {
      const s = calcSize(144, 144);
      expect(s.scale(16, 0)).toBe(16);
    });

    test("rounding behavior", () => {
      const s = calcSize(144, 144);
      // 144 * 33/100 = 47.52 → rounds to 48
      expect(s.w(33)).toBe(48);
      // 144 * 67/100 = 96.48 → rounds to 96
      expect(s.w(67)).toBe(96);
    });

    test("portrait surface", () => {
      const s = calcSize(50, 100);
      expect(s.portrait).toBe(true);
      expect(s.landscape).toBe(false);
      expect(s.square).toBe(false);
    });
  });
});
