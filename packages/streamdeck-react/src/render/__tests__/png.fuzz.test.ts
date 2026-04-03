import { describe, expect, test } from "bun:test";
import { fuzz, gen, setSeed } from "@/test-utils/fuzz";
import { encodePng } from "@/render/png";
import { resetBufferPool } from "@/render/buffer-pool";

// ── PNG Encoder Fuzz Tests ──────────────────────────────────────────
//
// Exercises the custom PNG encoder with randomized dimensions and pixel
// data to verify:
//
//   1. Never throws on valid inputs
//   2. Output always starts with the PNG signature
//   3. Output is a valid buffer (non-empty for non-zero dimensions)
//   4. Various dimension edge cases are handled
//   5. The buffer pool is not corrupted by rapid encode cycles

setSeed(42);

// ── PNG Signature (first 8 bytes) ───────────────────────────────────
const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];

describe("fuzz: encodePng", () => {
  test("never throws on valid dimensions (500 iterations)", () => {
    fuzz(500, () => {
      const width = gen.int(1, 256);
      const height = gen.int(1, 256);
      const rgba = new Uint8Array(width * height * 4);
      // Fill with random pixel data
      for (let i = 0; i < rgba.length; i++) {
        rgba[i] = gen.int(0, 255);
      }

      expect(() => encodePng(width, height, rgba)).not.toThrow();
      resetBufferPool();
    });
  });

  test("output always starts with PNG signature (500 iterations)", () => {
    fuzz(500, () => {
      const width = gen.int(1, 64);
      const height = gen.int(1, 64);
      const rgba = new Uint8Array(width * height * 4);

      const result = encodePng(width, height, rgba);

      for (let i = 0; i < 8; i++) {
        expect(result[i]).toBe(PNG_SIG[i]);
      }

      resetBufferPool();
    });
  });

  test("output length is always positive for non-zero dimensions (500 iterations)", () => {
    fuzz(500, () => {
      const width = gen.int(1, 128);
      const height = gen.int(1, 128);
      const rgba = new Uint8Array(width * height * 4);

      const result = encodePng(width, height, rgba);
      expect(result.length).toBeGreaterThan(0);

      resetBufferPool();
    });
  });

  test("handles 1x1 pixel images", () => {
    const rgba = new Uint8Array([255, 0, 0, 255]); // Red pixel
    const result = encodePng(1, 1, rgba);
    expect(result.length).toBeGreaterThan(8); // At least the signature
    for (let i = 0; i < 8; i++) {
      expect(result[i]).toBe(PNG_SIG[i]);
    }
  });

  test("handles wide images (width >> height)", () => {
    const width = 800;
    const height = 1;
    const rgba = new Uint8Array(width * height * 4);
    const result = encodePng(width, height, rgba);
    expect(result.length).toBeGreaterThan(0);
    resetBufferPool();
  });

  test("handles tall images (height >> width)", () => {
    const width = 1;
    const height = 800;
    const rgba = new Uint8Array(width * height * 4);
    const result = encodePng(width, height, rgba);
    expect(result.length).toBeGreaterThan(0);
    resetBufferPool();
  });

  test("identical pixel data produces identical PNGs (200 iterations)", () => {
    fuzz(200, () => {
      const width = gen.int(1, 32);
      const height = gen.int(1, 32);
      const rgba = new Uint8Array(width * height * 4);
      for (let i = 0; i < rgba.length; i++) {
        rgba[i] = gen.int(0, 255);
      }

      const a = encodePng(width, height, rgba);
      const b = encodePng(width, height, rgba);

      // Same input should produce byte-identical output (deflate is deterministic)
      expect(a.length).toBe(b.length);
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
          throw new Error(`PNG output differs at byte ${i}`);
        }
      }

      resetBufferPool();
    });
  });

  test("works with Buffer input (not just Uint8Array)", () => {
    const width = 4;
    const height = 4;
    const rgba = Buffer.alloc(width * height * 4, 128);
    const result = encodePng(width, height, rgba);
    expect(result.length).toBeGreaterThan(0);
    resetBufferPool();
  });

  test("handles all-zero pixel data", () => {
    const width = 32;
    const height = 32;
    const rgba = new Uint8Array(width * height * 4); // All zeros (transparent black)
    const result = encodePng(width, height, rgba);
    expect(result.length).toBeGreaterThan(0);
  });

  test("handles all-255 pixel data", () => {
    const width = 32;
    const height = 32;
    const rgba = new Uint8Array(width * height * 4).fill(255); // White opaque
    const result = encodePng(width, height, rgba);
    expect(result.length).toBeGreaterThan(0);
  });

  test("buffer pool handles rapid encode cycles without corruption (200 iterations)", () => {
    fuzz(200, () => {
      const width = gen.int(1, 64);
      const height = gen.int(1, 64);
      const rgba = new Uint8Array(width * height * 4);
      for (let i = 0; i < rgba.length; i++) {
        rgba[i] = gen.int(0, 255);
      }

      // Rapid sequential encodes should not corrupt the pool
      const a = encodePng(width, height, rgba);
      const b = encodePng(width, height, rgba);

      expect(a.length).toBe(b.length);
    });
  });
});
