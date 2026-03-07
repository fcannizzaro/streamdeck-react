// ── Minimal PNG Encoder ──────────────────────────────────────────────
// Encodes raw RGBA pixels to PNG using Node.js built-in zlib.
// No external image-processing dependencies required.

import { deflateSync } from "node:zlib";

// ── CRC-32 Lookup Table (ISO 3309 polynomial) ──────────────────────

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c;
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = crcTable[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ── PNG Chunk Builder ───────────────────────────────────────────────

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBytes, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([length, typeBytes, data, crcBuf]);
}

// ── PNG Signature ───────────────────────────────────────────────────

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// ── Public API ──────────────────────────────────────────────────────

/**
 * Encode raw RGBA pixels into a PNG buffer.
 *
 * @param width  Image width in pixels.
 * @param height Image height in pixels.
 * @param rgba   Raw RGBA pixel data (width × height × 4 bytes, row-major).
 */
export function encodePng(
  width: number,
  height: number,
  rgba: Buffer | Uint8Array,
): Buffer {
  // IHDR: width(4) + height(4) + bitDepth(1) + colorType(1) + compression(1) + filter(1) + interlace(1)
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter method: adaptive
  ihdr[12] = 0; // interlace: none

  // Scanlines: prepend filter byte (0 = None) to each row
  const rowBytes = width * 4;
  const filtered = Buffer.alloc(height * (1 + rowBytes));
  for (let y = 0; y < height; y++) {
    const dstOff = y * (1 + rowBytes);
    filtered[dstOff] = 0; // filter: None
    const srcOff = y * rowBytes;
    // Copy the row — handles both Buffer and Uint8Array
    for (let i = 0; i < rowBytes; i++) {
      filtered[dstOff + 1 + i] = rgba[srcOff + i]!;
    }
  }

  const compressed = deflateSync(filtered);

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
