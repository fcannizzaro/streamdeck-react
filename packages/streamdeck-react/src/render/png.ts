// ── Minimal PNG Encoder ──────────────────────────────────────────────
//
// Encodes raw RGBA pixels to PNG using Node.js built-in zlib.
// No external image-processing dependencies required.
//
// Why a custom encoder:
//   Stream Deck plugins run in a sandboxed Node.js environment where
//   installing native image libraries (sharp, canvas) is impractical.
//   This encoder depends only on Node.js built-in `zlib` and produces
//   valid PNG files for the Stream Deck SDK's setImage/setFeedback.
//
// PNG file structure produced:
//
//   ┌───────────────┐
//   │ PNG Signature  │  8 bytes: 137 80 78 71 13 10 26 10
//   ├───────────────┤
//   │ IHDR chunk     │  13 bytes: width, height, 8-bit RGBA
//   ├───────────────┤
//   │ IDAT chunk     │  deflate-compressed scanlines
//   │                │  (each row prefixed with filter byte 0 = None)
//   ├───────────────┤
//   │ IEND chunk     │  0 bytes (empty)
//   └───────────────┘
//
// Each chunk is: [4-byte length][4-byte type][data][4-byte CRC-32]
//
// Uses synchronous deflateSync for compression — at 30fps the overhead
// is negligible and avoids maintaining a second async code path.
//
import { deflateSync } from "node:zlib";
import { getBufferPool } from "./buffer-pool";

// ── CRC-32 Lookup Table (ISO 3309 polynomial) ──────────────────────
// Pre-computed 256-entry table for the standard CRC-32 used in PNG.
// Polynomial 0xEDB88320 is the bit-reversed form of 0x04C11DB7.
// Built once at module load; used by every PNG chunk.

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

// ── Shared Helpers ──────────────────────────────────────────────────

function buildIhdr(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter method: adaptive
  ihdr[12] = 0; // interlace: none
  return ihdr;
}

function buildFilteredScanlines(width: number, height: number, rgba: Buffer | Uint8Array): Buffer {
  const rowBytes = width * 4;
  const filteredSize = height * (1 + rowBytes);
  const pool = getBufferPool();
  const filtered = pool.acquire(filteredSize);
  for (let y = 0; y < height; y++) {
    const dstOff = y * (1 + rowBytes);
    filtered[dstOff] = 0; // filter: None
    const srcOff = y * rowBytes;
    // Bulk copy the row — ~4x faster than byte-by-byte for large images.
    // Dual-path: Buffer.copy() is fastest on Node; Uint8Array.set() is the
    // universal fallback (Buffer extends Uint8Array, so .set() works for both,
    // but .copy() avoids the subarray allocation overhead for Buffer inputs).
    if (Buffer.isBuffer(rgba)) {
      rgba.copy(filtered, dstOff + 1, srcOff, srcOff + rowBytes);
    } else {
      filtered.set(rgba.subarray(srcOff, srcOff + rowBytes), dstOff + 1);
    }
  }
  return filtered;
}

function assemblePng(ihdr: Buffer, compressed: Buffer): Buffer {
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Encode raw RGBA pixels into a PNG buffer (synchronous).
 *
 * @param width  Image width in pixels.
 * @param height Image height in pixels.
 * @param rgba   Raw RGBA pixel data (width × height × 4 bytes, row-major).
 */
export function encodePng(width: number, height: number, rgba: Buffer | Uint8Array): Buffer {
  // Guard against invalid dimensions that could cause Buffer.alloc failures
  // or incorrect buffer sizing from pipeline bugs.  (SDR-005)
  // 4096 is a generous upper bound — Stream Deck hardware caps at 800px.
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > 4096 ||
    height > 4096
  ) {
    throw new RangeError(`encodePng: invalid dimensions ${width}×${height} (must be 1–4096)`);
  }
  const expectedBytes = width * height * 4;
  if (rgba.length < expectedBytes) {
    throw new RangeError(
      `encodePng: rgba buffer too small (${rgba.length} bytes, need ${expectedBytes} for ${width}×${height})`,
    );
  }

  const ihdr = buildIhdr(width, height);
  const filtered = buildFilteredScanlines(width, height, rgba);
  const compressed = deflateSync(filtered);
  getBufferPool().release(filtered);
  return assemblePng(ihdr, compressed);
}
