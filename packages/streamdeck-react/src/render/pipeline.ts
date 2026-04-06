// ── Render Pipeline ─────────────────────────────────────────────────
//
// Central module that converts a VNode tree into a raster image pushed
// to Stream Deck hardware.  Every render attempt passes through a
// multi-tier skip hierarchy designed to avoid redundant work:
//
//   flush()
//     │
//     ▼
//   Phase 1: Dirty-flag check
//     │  VNode mutation tracking — if no VNode was mutated since
//     │  the last flush, skip entirely.  Cost: O(1).
//     │  (isContainerDirty)
//     ▼
//   Phase 2: Merkle-tree hash → Image cache lookup
//     │  Compute a structural hash of the VNode tree.  Unchanged
//     │  subtrees reuse cached hashes (O(depth) for single-node
//     │  mutations instead of O(n)).  If the hash+config key is
//     │  found in the LRU image cache, return the cached data URI.
//     │  (computeTreeHash → computeCacheKey → ImageCache.get)
//     ▼
//   Phase 3: Takumi render (main thread or worker)
//     │  Convert VNode tree → Takumi node tree (direct bypass,
//     │  skipping React element creation and fromJsx()).  Pass to
//     │  the native Takumi renderer for rasterization.
//     │  (vnodeToTakumiNode → Renderer.render)
//     ▼
//   Phase 4: FNV-1a output dedup
//     │  Hash the raw raster buffer.  If identical to the previous
//     │  frame's hash (lastSvgHash), skip encoding and hardware
//     │  push — the component re-rendered but produced no visual
//     │  change.  (fnv1a comparison)
//     ▼
//   Encode → base64 data URI → store in cache → push to hardware
//
// Two entry points:
//   renderToDataUri  — keys/dials: returns base64 data URI string
//   renderToRaw      — TouchStrip: returns raw RGBA Buffer for slicing

import type { Renderer, OutputFormat } from "@takumi-rs/core";
import type { Node as TakumiNode } from "@takumi-rs/helpers";
import { type VContainer, type VNode, isContainerDirty } from "@/reconciler/vnode";
import { fnv1a, computeTreeHash, computeCacheKey } from "./cache";
import { encodePng } from "./png";
import { getImageCache, getTouchStripCache, type CacheStats } from "./image-cache";
import { getBufferPool } from "./buffer-pool";
import type { RenderPool } from "./render-pool";
import { getMetrics } from "./metrics";
import { serializeSvgTree } from "./svg";

// ── Render Configuration ────────────────────────────────────────────

/** Per-render timing and diagnostic data exposed via `RenderConfig.onProfile`. */
export interface RenderProfile {
  /** Time to convert VNode tree to Takumi node tree (ms). */
  vnodeConversionMs: number;
  takumiRenderMs: number;
  hashMs: number;
  base64Ms: number;
  totalMs: number;
  skipped: boolean;
  /** Whether this render was served from the image cache. */
  cacheHit: boolean;
  treeDepth: number;
  nodeCount: number;
  /** Image cache statistics at the time of this render. */
  cacheStats: CacheStats | null;
}

export interface RenderConfig {
  /**
   * Lazy renderer factory.  The Takumi `Renderer` is only instantiated on
   * the first call, deferring the cost of loading the native Rust addon and
   * building the font database (~12-18 MB) until an action actually needs
   * to render.  Subsequent calls return the cached instance.
   */
  getRenderer: () => Renderer;
  imageFormat: OutputFormat;
  caching: boolean;
  devicePixelRatio: number;
  /** Enable performance diagnostics (duplicate detection, depth warnings). */
  debug: boolean;
  /** Maximum image cache size in bytes. Set to 0 to disable. @default 16777216 (16 MB) */
  imageCacheMaxBytes: number;
  /** Maximum TouchStrip cache size in bytes. Set to 0 to disable. @default 8388608 (8 MB) */
  touchStripCacheMaxBytes: number;
  /** Worker thread pool for offloading Takumi renders. null = main-thread rendering. */
  renderPool: RenderPool | null;
  /** DevTools callback. Called after a non-null render with the container and data URI. */
  onRender?: (container: VContainer, dataUri: string) => void;
  /** Profiling callback. Called after every renderToDataUri / renderToRaw attempt. */
  onProfile?: (profile: RenderProfile) => void;
  /**
   * CSS stylesheets to pass to the Takumi renderer.  Enables full
   * Tailwind v4 support including `@theme` blocks, custom utilities,
   * and any standard CSS.
   *
   * Compiled at build time via `@tailwindcss/vite` and imported with
   * `?inline`.  Passed to every `Renderer.render()` call.
   */
  stylesheets?: string[];
}

// ── Hoisted Constants ───────────────────────────────────────────────

const ROOT_STYLE = { display: "flex", width: "100%", height: "100%" } as const;

/** Warn threshold for consecutive identical renders in debug mode. */
const DUP_RENDER_WARN_THRESHOLD = 3;

/** Maximum recommended VNode tree depth. Warn in debug mode when exceeded. */
const MAX_DEPTH_WARN = 25;

/** Whether we've already warned about tree depth (avoid log spam). */
let depthWarned = false;

// ── VNode → Takumi Node Conversion ──────────────────────────────────
// Converts VNodes directly to Takumi's plain-object node format
// in a single tree walk.
//
// The mapping handles four VNode types:
//   #text  → Takumi TextNode { type: "text", text }
//   img    → Takumi ImageNode { type: "image", src }
//   svg    → Takumi ImageNode { type: "image", src: "<svg>...</svg>" }
//   *      → Takumi ContainerNode { type: "container", children }
//
// Class name handling — two complementary systems:
//
//   tw        → Takumi's built-in Tailwind parser (medium priority)
//              Resolves standard utilities: flex, bg-blue-500, p-4, etc.
//              Does NOT support custom @theme tokens.
//
//   className → CSS stylesheet selector matching
//              Matches rules from compiled CSS stylesheets (e.g.
//              @tailwindcss/vite output with @theme blocks).
//              Enables custom tokens: bg-primary, text-surface, etc.
//
// Both are set from the same combined class string so that:
//   - Standard utilities work via the built-in parser (tw)
//   - Custom theme classes work via CSS selector matching (className)
//   - When both resolve the same class, tw takes priority (by design)

// ── Props keys to skip when copying VNode props to Takumi nodes ─────
// These are handled specially by vnodeToTakumiNode (className → tw,
// src → image node, children → structural).
const SKIP_PROPS = new Set(["children", "className", "src", "tw"]);

// ── Copy VNode props to a Takumi node ──────────────────────────────
// Copies all non-skipped props from the VNode directly onto the target
// Takumi node object.
function copyPropsToNode(target: Record<string, unknown>, props: Record<string, unknown>): void {
  for (const key of Object.keys(props)) {
    if (!SKIP_PROPS.has(key)) {
      target[key] = props[key];
    }
  }
}

function vnodeToTakumiNode(node: VNode, depth = 0): TakumiNode {
  // Depth warning in debug mode (fires once to avoid log spam)
  if (!depthWarned && depth > MAX_DEPTH_WARN) {
    depthWarned = true;
    console.warn(
      `[@fcannizzaro/streamdeck-react] VNode tree depth ${depth} exceeds recommended limit ${MAX_DEPTH_WARN}. Deep nesting increases render cost.`,
    );
  }

  // Text nodes → Takumi TextNode
  if (node.type === "#text") {
    return { type: "text", text: node.text ?? "" };
  }

  const props = node.props;

  // Map className → tw
  const rawTw = typeof props.tw === "string" ? props.tw : undefined;
  const className = props.className;
  let tw: string | undefined = rawTw;
  if (typeof className === "string" && className.length > 0) {
    tw = tw ? tw + " " + className : className;
  }

  // Image nodes → Takumi ImageNode
  if (node.type === "img" && typeof props.src === "string") {
    const result: Record<string, unknown> = { type: "image", src: props.src };
    if (tw) {
      result.tw = tw;
      result.className = tw;
    }
    copyPropsToNode(result, props);
    return result as TakumiNode;
  }

  // SVG nodes → Takumi ImageNode (serialize subtree to SVG markup)
  if (node.type === "svg") {
    const svgMarkup = serializeSvgTree(node);
    const result: Record<string, unknown> = { type: "image", src: svgMarkup, tagName: "svg" };
    const width = typeof props.width === "number" ? props.width : undefined;
    const height = typeof props.height === "number" ? props.height : undefined;
    if (width != null) result.width = width;
    if (height != null) result.height = height;
    if (tw) {
      result.tw = tw;
      result.className = tw;
    }
    if (props.style) result.style = props.style;
    return result as TakumiNode;
  }

  // All other nodes → Takumi ContainerNode
  const result: Record<string, unknown> = { type: "container" };
  if (tw) {
    result.tw = tw;
    result.className = tw;
  }
  copyPropsToNode(result, props);

  if (node.children.length > 0) {
    result.children = node.children.map((child) => vnodeToTakumiNode(child, depth + 1));
  }

  return result as TakumiNode;
}

/** Build the root Takumi container wrapping the VNode children. */
export function buildTakumiRoot(container: VContainer): TakumiNode {
  const children = container.children.map(vnodeToTakumiNode);
  return {
    type: "container",
    style: ROOT_STYLE,
    children,
  } as TakumiNode;
}

// ── Tree Stats ──────────────────────────────────────────────────────

export function measureTree(nodes: VNode[]): { depth: number; count: number } {
  let maxDepth = 0;
  let count = 0;

  function walk(children: VNode[], depth: number): void {
    for (const child of children) {
      count++;
      if (depth > maxDepth) maxDepth = depth;
      walk(child.children, depth + 1);
    }
  }

  walk(nodes, 1);
  return { depth: maxDepth, count };
}

// ── Buffer to Data URI ──────────────────────────────────────────────

export function bufferToDataUri(buffer: Buffer | Uint8Array, format: string): string {
  const b = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  return `data:image/${format};base64,${b.toString("base64")}`;
}

// ── Profile Helper ──────────────────────────────────────────────────

function emitProfile(
  config: RenderConfig,
  times: { t0: number; t1: number; t2: number; t3: number },
  opts: { skipped: boolean; cacheHit: boolean; container: VContainer },
): void {
  const stats = measureTree(opts.container.children);
  const cache = config.imageCacheMaxBytes > 0 ? getImageCache(config.imageCacheMaxBytes) : null;
  config.onProfile!({
    vnodeConversionMs: times.t1 - times.t0,
    takumiRenderMs: times.t2 - times.t1,
    hashMs: times.t3 - times.t2,
    base64Ms: 0,
    totalMs: times.t3 - times.t0,
    skipped: opts.skipped,
    cacheHit: opts.cacheHit,
    treeDepth: stats.depth,
    nodeCount: stats.count,
    cacheStats: cache?.stats ?? null,
  });
}

// ── Render Pipeline ─────────────────────────────────────────────────
// Main entry point for key/dial rendering.  Returns a base64 data URI
// or null (if skipped by any of the 4 skip tiers).

export async function renderToDataUri(
  container: VContainer,
  width: number,
  height: number,
  config: RenderConfig,
): Promise<string | null> {
  if (container.children.length === 0) {
    return null;
  }

  getMetrics().recordFlush();

  // Pre-render skip: if no VNode was mutated since last flush, skip entirely
  if (config.caching && !isContainerDirty(container)) {
    getMetrics().recordDirtySkip();
    return null;
  }

  const profiling = config.onProfile != null;
  const t0 = profiling ? performance.now() : 0;
  let t1 = t0;
  let t2 = t0;

  // ── Image Cache Lookup (Phase 2) ──────────────────────────────
  // Compute Merkle hash of the VNode tree. If cached, skip the entire
  // Takumi render pipeline and return the cached data URI.
  //
  // The treeHash and cacheKey are hoisted so they can be reused at
  // cache-store time without recomputing.
  let treeHash: number | undefined;
  let cacheKey: number | undefined;

  if (config.caching && config.imageCacheMaxBytes > 0) {
    treeHash = computeTreeHash(container);
    cacheKey = computeCacheKey(
      treeHash,
      width,
      height,
      config.devicePixelRatio,
      config.imageFormat,
    );
    const cache = getImageCache(config.imageCacheMaxBytes);
    const cached = cache.get(cacheKey);

    if (cached !== undefined) {
      // Cache hit — skip everything
      getMetrics().recordCacheHit();
      if (profiling) {
        const tNow = performance.now();
        emitProfile(
          config,
          { t0, t1: tNow, t2: tNow, t3: tNow },
          { skipped: false, cacheHit: true, container },
        );
      }
      container._dupCount = 0;
      config.onRender?.(container, cached);
      // Dirty flags are cleared by the caller (ReactRoot.doFlush),
      // NOT here — see clearDirtyFlags race condition comment in root.ts.
      return cached;
    }
  }

  // ── Render (worker or main thread) ─────────────────────────────
  let buffer: Buffer | Uint8Array;

  if (config.renderPool?.isAvailable) {
    // Worker path: conversion + render all happen in the worker.
    // Sub-stage timing is not available in worker mode.
    buffer = await config.renderPool.render(
      container.children,
      width,
      height,
      config.imageFormat,
      config.devicePixelRatio,
      config.stylesheets,
    );
    t2 = profiling ? performance.now() : 0;
    t1 = t0; // no sub-stage data
  } else {
    // Main-thread path: VNode → Takumi node (direct conversion)
    const rootNode = buildTakumiRoot(container);

    t1 = profiling ? performance.now() : 0;

    // Render to raster image
    buffer = await config.getRenderer().render(rootNode, {
      width,
      height,
      format: config.imageFormat,
      devicePixelRatio: config.devicePixelRatio,
      stylesheets: config.stylesheets,
    });

    t2 = profiling ? performance.now() : 0;
  }

  // Phase 4: Cache check — skip if identical to last render (post-render dedup)
  if (config.caching) {
    const hash = fnv1a(buffer);
    if (hash === container.lastSvgHash) {
      getMetrics().recordHashDedup();
      // Duplicate detection in debug mode
      if (config.debug) {
        container._dupCount++;
        if (container._dupCount > DUP_RENDER_WARN_THRESHOLD) {
          console.warn(
            `[@fcannizzaro/streamdeck-react] ${container._dupCount} consecutive identical renders — component likely re-rendering without visual change`,
          );
        }
      }

      if (profiling) {
        const tEnd = performance.now();
        emitProfile(
          config,
          { t0, t1, t2, t3: tEnd },
          { skipped: true, cacheHit: false, container },
        );
      }

      // Dirty flags are cleared by the caller — see race condition comment.
      return null; // No change
    }
    container.lastSvgHash = hash;
    container._dupCount = 0;
  }

  const dataUri = bufferToDataUri(buffer, config.imageFormat);

  // ── Store in image cache ──────────────────────────────────────
  // Reuse hoisted treeHash/cacheKey from the lookup phase above.
  // If caching was disabled or imageCacheMaxBytes was 0, the hoisted
  // variables are still undefined — recompute only in that edge case.
  if (config.caching && config.imageCacheMaxBytes > 0) {
    if (treeHash === undefined || cacheKey === undefined) {
      treeHash = computeTreeHash(container);
      cacheKey = computeCacheKey(
        treeHash,
        width,
        height,
        config.devicePixelRatio,
        config.imageFormat,
      );
    }
    const cache = getImageCache(config.imageCacheMaxBytes);
    // Approximate byte size: dataUri string length × 2 (UTF-16) + overhead
    cache.set(cacheKey, dataUri, dataUri.length * 2 + 64);
  }

  // Record render for metrics
  getMetrics().recordRender(t2 - t0);

  if (profiling) {
    const tEnd = performance.now();
    emitProfile(config, { t0, t1, t2, t3: tEnd }, { skipped: false, cacheHit: false, container });
  }

  config.onRender?.(container, dataUri);
  // Dirty flags are cleared by the caller — see race condition comment.
  return dataUri;
}
// ── Render to Raw RGBA ──────────────────────────────────────────────
//
// TouchStrip-specific entry point.  Produces raw RGBA pixels (no PNG
// encoding overhead) for a single full-width render of the component
// tree.  The caller (TouchStripRoot.doFlush) then crops per-encoder
// segments via cropSlice() and encodes each independently.
//
// Follows the same multi-tier skip hierarchy as renderToDataUri():
//
//   flush()
//     │
//     ├─ Phase 1: Dirty-flag check        → return null (metrics: dirtySkip)
//     │
//     ├─ Phase 2: Merkle hash → TB cache  → return cached buffer (metrics: cacheHit)
//     │
//     ├─ Phase 3: Takumi render (raw RGBA) ── worker or main thread
//     │
//     ├─ Phase 4: FNV-1a output dedup     → return null (metrics: hashDedup)
//     │
//     └─ Store in TB cache → return { buffer, width, height }
//
// Differences from renderToDataUri():
//
//   - Uses the TouchStrip LRU cache (separate size budget)
//   - No base64 encoding step — raw RGBA is returned directly
//
// Profiling integration:
//
//   config.onProfile fires at every exit point (cache hit, hash dedup,
//   and normal render), consistent with renderToDataUri().  This data
//   flows through the devtools bridge → SSE → Performance panel.
//
//     renderToRaw()                     DevTools Bridge
//     ─────────────                     ───────────────
//     emitProfile() ──onProfile()──→    bridge.onProfile()
//                                         │
//     (caller calls onRender) ────→    bridge.onRender()
//                                         │ consumes stashed profile
//                                         ▼
//                                       emitTouchStripRender()
//                                         │ SSE "render:touchStrip"
//                                         ▼
//                                       Performance Panel
//
//   Zero-cost when disabled: all performance.now() calls are gated
//   behind `profiling` (set to false when config.onProfile is null).

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

  getMetrics().recordFlush();

  // ── Phase 1: Dirty-flag check ─────────────────────────────────
  // If no VNode was mutated since last flush, skip entirely.
  // Cost: O(1) — just a boolean check on the container.
  if (config.caching && !isContainerDirty(container)) {
    getMetrics().recordDirtySkip();
    return null;
  }

  // ── Profiling setup ───────────────────────────────────────────
  //   t0 ── start
  //   t1 ── after VNode→Takumi node conversion
  //   t2 ── after Takumi renderer.render()
  const profiling = config.onProfile != null;
  const t0 = profiling ? performance.now() : 0;
  let t1 = t0;
  let t2 = t0;

  // ── Phase 2: TouchStrip Cache Lookup ────────────────────────────
  // Compute Merkle hash of the VNode tree + render config params.
  // If found in the TouchStrip-specific LRU cache, skip the Takumi
  // render and return the cached raw RGBA buffer directly.
  //
  // Hoisted so the same values can be reused at cache-store time
  // after rendering (avoids recomputing computeTreeHash twice).
  let treeHash: number | undefined;
  let cacheKey: number | undefined;

  if (config.caching && config.touchStripCacheMaxBytes > 0) {
    treeHash = computeTreeHash(container);
    cacheKey = computeCacheKey(treeHash, width, height, config.devicePixelRatio, "raw");
    const cache = getTouchStripCache(config.touchStripCacheMaxBytes);
    const cached = cache.get(cacheKey);

    if (cached !== undefined) {
      getMetrics().recordCacheHit();
      if (profiling) {
        const tNow = performance.now();
        emitProfile(
          config,
          { t0, t1: tNow, t2: tNow, t3: tNow },
          { skipped: false, cacheHit: true, container },
        );
      }
      // Dirty flags are cleared by the caller — see race condition comment.
      return { buffer: cached, width, height };
    }
  }

  // ── Phase 3: Takumi Render (raw RGBA) ─────────────────────────
  let buffer: Buffer | Uint8Array;

  if (config.renderPool?.isAvailable) {
    // Worker path: conversion + render happens in the worker.
    buffer = await config.renderPool.render(
      container.children,
      width,
      height,
      "raw",
      config.devicePixelRatio,
      config.stylesheets,
    );
    t2 = profiling ? performance.now() : 0;
    t1 = t0; // no sub-stage data in worker mode
  } else {
    // Main-thread path: VNode → Takumi node (direct conversion)
    const rootNode = buildTakumiRoot(container);

    t1 = profiling ? performance.now() : 0;

    buffer = await config.getRenderer().render(rootNode, {
      width,
      height,
      format: "raw" as OutputFormat,
      devicePixelRatio: config.devicePixelRatio,
      stylesheets: config.stylesheets,
    });

    t2 = profiling ? performance.now() : 0;
  }

  // ── Phase 4: FNV-1a Output Dedup ──────────────────────────────
  // Hash the raw raster buffer.  If identical to the previous frame,
  // skip — the component re-rendered but produced no visual change.
  if (config.caching) {
    const hash = fnv1a(buffer);
    if (hash === container.lastSvgHash) {
      getMetrics().recordHashDedup();
      if (profiling) {
        const tEnd = performance.now();
        emitProfile(
          config,
          { t0, t1, t2, t3: tEnd },
          { skipped: true, cacheHit: false, container },
        );
      }
      // Dirty flags are cleared by the caller — see race condition comment.
      return null; // No change
    }
    container.lastSvgHash = hash;
  }

  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

  // ── Store in TouchStrip cache ───────────────────────────────────
  // Cache the raw RGBA buffer for future Merkle-hash hits.
  // byteLength + 64 accounts for Map/LRU overhead.
  // Reuse hoisted treeHash/cacheKey from Phase 2 lookup above.
  if (config.caching && config.touchStripCacheMaxBytes > 0) {
    if (treeHash === undefined || cacheKey === undefined) {
      treeHash = computeTreeHash(container);
      cacheKey = computeCacheKey(treeHash, width, height, config.devicePixelRatio, "raw");
    }
    const cache = getTouchStripCache(config.touchStripCacheMaxBytes);
    cache.set(cacheKey, buf, buf.byteLength + 64);
  }

  // Record render for metrics
  getMetrics().recordRender(t2 - t0);

  if (profiling) {
    const tEnd = performance.now();
    emitProfile(config, { t0, t1, t2, t3: tEnd }, { skipped: false, cacheHit: false, container });
  }

  // Dirty flags are cleared by the caller — see race condition comment.
  return { buffer: buf, width, height };
}

// ── Raw Buffer Crop ─────────────────────────────────────────────────
// Extracts a rectangular slice from a raw RGBA buffer (row-major order).
// Used by the TouchStrip pipeline to cut per-encoder segments from a
// single full-width render.
//
// Memory layout of the source buffer (fullWidth × segmentHeight):
//
//   row 0: |  col0   |  col1   |  col2   |  col3   |
//   row 1: |  col0   |  col1   |  col2   |  col3   |
//   ...
//
// Each pixel is 4 bytes (RGBA).  The crop copies `segmentWidth * 4`
// bytes per row at offset `column * segmentWidth * 4`.
//
// Uses the buffer pool to avoid GC pressure during 30fps animation —
// the caller MUST release the returned buffer via pool.release().

export function cropSlice(
  raw: Buffer,
  fullWidth: number,
  column: number,
  segmentWidth: number,
  segmentHeight: number,
): Buffer {
  // Validate that the requested slice region fits within the source
  // buffer.  Buffer.copy silently truncates out-of-bounds reads
  // (memory-safe), but the resulting pixel data would be wrong —
  // better to fail loudly.  (SDR-006)
  const rightEdge = column * segmentWidth + segmentWidth;
  if (rightEdge > fullWidth) {
    throw new RangeError(
      `cropSlice: slice region exceeds source width (column=${column}, segmentWidth=${segmentWidth}, fullWidth=${fullWidth})`,
    );
  }
  const expectedBytes = fullWidth * segmentHeight * 4;
  if (raw.length < expectedBytes) {
    throw new RangeError(
      `cropSlice: source buffer too small (${raw.length} bytes, need ${expectedBytes} for ${fullWidth}×${segmentHeight})`,
    );
  }

  const pool = getBufferPool();
  const sliceSize = segmentWidth * segmentHeight * 4;
  const slice = pool.acquire(sliceSize);
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
  getBufferPool().release(cropped);
  return bufferToDataUri(png, "png");
}
