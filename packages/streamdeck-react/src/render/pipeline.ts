import type { Renderer, OutputFormat } from "@takumi-rs/core";
import { fromJsx } from "@takumi-rs/helpers/jsx";
import { createElement } from "react";
import { vnodeToElement, type VContainer } from "@/reconciler/vnode";
import { fnv1a } from "./cache";
import { encodePng } from "./png";

// ── Render Configuration ────────────────────────────────────────────

export interface RenderConfig {
  renderer: Renderer;
  imageFormat: OutputFormat;
  caching: boolean;
  devicePixelRatio: number;
}

// ── Buffer to Data URI ──────────────────────────────────────────────

export function bufferToDataUri(
  buffer: Buffer | Uint8Array,
  format: string,
): string {
  const b = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  return `data:image/${format};base64,${b.toString("base64")}`;
}

// ── Render Pipeline ─────────────────────────────────────────────────

export async function renderToDataUri(
  container: VContainer,
  width: number,
  height: number,
  config: RenderConfig,
): Promise<string | null> {
  if (container.children.length === 0) {
    return null;
  }

  // 1. Convert VNode tree → React elements (with className → tw mapping)
  const rootChildren = container.children.map(vnodeToElement);
  const rootElement = createElement(
    "div",
    {
      style: {
        display: "flex",
        width: "100%",
        height: "100%",
      },
    },
    ...rootChildren,
  );

  // 2. Convert React elements → Takumi nodes
  const { node, stylesheets } = await fromJsx(rootElement);

  // 3. Render to raster image
  const buffer = await config.renderer.render(node, {
    width,
    height,
    format: config.imageFormat,
    stylesheets,
    devicePixelRatio: config.devicePixelRatio,
  });

  // 4. Cache check — skip if identical to last render
  if (config.caching) {
    const hash = fnv1a(buffer);
    if (hash === container.lastSvgHash) {
      return null; // No change
    }
    container.lastSvgHash = hash;
  }

  return bufferToDataUri(buffer, config.imageFormat);
}

// ── Raw Render Pipeline ─────────────────────────────────────────────
// Renders the component tree to raw RGBA pixels (no encoding overhead).
// Used by the touchbar pipeline for efficient buffer-based slicing.

export interface RawRenderResult {
  buffer: Buffer;
  width: number;
  height: number;
}

export async function renderToRaw(
  container: VContainer,
  width: number,
  height: number,
  config: RenderConfig,
): Promise<RawRenderResult | null> {
  if (container.children.length === 0) {
    return null;
  }

  // 1. Convert VNode tree → React elements
  const rootChildren = container.children.map(vnodeToElement);
  const rootElement = createElement(
    "div",
    {
      style: {
        display: "flex",
        width: "100%",
        height: "100%",
      },
    },
    ...rootChildren,
  );

  // 2. Convert React elements → Takumi nodes
  const { node, stylesheets } = await fromJsx(rootElement);

  // 3. Render to raw RGBA pixels
  const buffer = await config.renderer.render(node, {
    width,
    height,
    format: "raw" as OutputFormat,
    stylesheets,
    devicePixelRatio: config.devicePixelRatio,
  });

  // 4. Cache check — skip if identical to last render
  if (config.caching) {
    const hash = fnv1a(buffer);
    if (hash === container.lastSvgHash) {
      return null; // No change
    }
    container.lastSvgHash = hash;
  }

  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  return { buffer: buf, width, height };
}

// ── Raw Buffer Crop ─────────────────────────────────────────────────
// Extracts a rectangular slice from a raw RGBA buffer (row-major).

export function cropSlice(
  raw: Buffer,
  fullWidth: number,
  column: number,
  segmentWidth: number,
  segmentHeight: number,
): Buffer {
  const slice = Buffer.alloc(segmentWidth * segmentHeight * 4);
  const srcRowBytes = fullWidth * 4;
  const dstRowBytes = segmentWidth * 4;
  const xOffset = column * segmentWidth * 4;

  for (let y = 0; y < segmentHeight; y++) {
    const srcOff = y * srcRowBytes + xOffset;
    const dstOff = y * dstRowBytes;
    raw.copy(slice, dstOff, srcOff, srcOff + dstRowBytes);
  }

  return slice;
}

// ── Slice to Data URI (buffer-based) ────────────────────────────────
// Crops a segment from raw RGBA and encodes it directly to a PNG data URI.
// Eliminates the extra Takumi render pass that the CSS-based renderSlice uses.

export function sliceToDataUri(
  raw: Buffer,
  fullWidth: number,
  fullHeight: number,
  column: number,
  segmentWidth: number,
  segmentHeight: number,
): string {
  const cropped = cropSlice(raw, fullWidth, column, segmentWidth, segmentHeight);
  const png = encodePng(segmentWidth, segmentHeight, cropped);
  return bufferToDataUri(png, "png");
}
