import type { Renderer, OutputFormat } from "@takumi-rs/core";
import { fromJsx } from "@takumi-rs/helpers/jsx";
import { createElement } from "react";
import { vnodeToElement, type VContainer } from "@/reconciler/vnode.ts";
import { fnv1a } from "./cache.ts";

// ── Render Configuration ────────────────────────────────────────────

export interface RenderConfig {
  renderer: Renderer;
  imageFormat: OutputFormat;
  caching: boolean;
}

// ── Buffer to Data URI ──────────────────────────────────────────────

function bufferToDataUri(
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
