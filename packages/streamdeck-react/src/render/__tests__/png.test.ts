import { describe, expect, test } from "bun:test";
import { encodePng } from "@/render/png";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function createRgbaBuffer(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      buffer[offset] = x * 40;
      buffer[offset + 1] = y * 50;
      buffer[offset + 2] = 200;
      buffer[offset + 3] = 255;
    }
  }
  return buffer;
}

describe("encodePng", () => {
  test("encodes a valid PNG header from Buffer input", () => {
    const rgba = createRgbaBuffer(4, 4);
    const png = encodePng(4, 4, rgba);

    expect(png.subarray(0, PNG_SIGNATURE.length)).toEqual(PNG_SIGNATURE);
  });

  test("encodes the same PNG bytes for Buffer and Uint8Array input", () => {
    const rgba = createRgbaBuffer(4, 4);
    const bufferPng = encodePng(4, 4, rgba);
    const arrayPng = encodePng(4, 4, new Uint8Array(rgba));

    expect(arrayPng).toEqual(bufferPng);
  });
});
