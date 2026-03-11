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
//   renderToRaw      — touchbar: returns raw RGBA Buffer for slicing

import type { Renderer, OutputFormat } from "@takumi-rs/core";
import type { Node as TakumiNode } from "@takumi-rs/helpers";
import { type VContainer, type VNode } from "@/reconciler/vnode";
import { isContainerDirty, clearDirtyFlags } from "@/reconciler/vnode";
import { fnv1a, computeTreeHash, computeCacheKey } from "./cache";
import { encodePng, encodePngAsync } from "./png";
import { getImageCache, getTouchbarCache, type CacheStats } from "./image-cache";
import { getBufferPool } from "./buffer-pool";
import type { RenderPool } from "./render-pool";
import { metrics } from "./metrics";
import { serializeSvgTree } from "./svg";

// ── Render Configuration ────────────────────────────────────────────

/** Per-render timing and diagnostic data exposed via `RenderConfig.onProfile`. */
export interface RenderProfile {
  vnodeToElementMs: number;
  fromJsxMs: number;
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
  renderer: Renderer;
  imageFormat: OutputFormat;
  caching: boolean;
  devicePixelRatio: number;
  /** Enable performance diagnostics (duplicate detection, depth warnings). */
  debug: boolean;
  /** Maximum image cache size in bytes. Set to 0 to disable. @default 16777216 (16 MB) */
  imageCacheMaxBytes: number;
  /** Maximum touchbar cache size in bytes. Set to 0 to disable. @default 8388608 (8 MB) */
  touchbarCacheMaxBytes: number;
  /** Worker thread pool for offloading Takumi renders. null = main-thread rendering. */
  renderPool: RenderPool | null;
  /** Image format for touchbar segment encoding. @default "webp" */
  touchbarImageFormat: OutputFormat;
  /** DevTools callback. Called after a non-null render with the container and data URI. */
  onRender?: (container: VContainer, dataUri: string) => void;
  /** Profiling callback. Called after every renderToDataUri / renderToRaw attempt. */
  onProfile?: (profile: RenderProfile) => void;
}

// ── Hoisted Constants ───────────────────────────────────────────────

const ROOT_STYLE = { display: "flex", width: "100%", height: "100%" } as const;

/** Warn threshold for consecutive identical renders in debug mode. */
const DUP_RENDER_WARN_THRESHOLD = 3;

/** Maximum recommended VNode tree depth. Warn in debug mode when exceeded. */
const MAX_DEPTH_WARN = 25;

/** Whether we've already warned about tree depth (avoid log spam). */
let depthWarned = false;

// ── Direct VNode → Takumi Node Bypass ───────────────────────────────
// Performance optimization: converts VNodes directly to Takumi's
// plain-object node format, bypassing two intermediate steps:
//
//   Standard path (eliminated):
//     VNode → vnodeToElement() → React element → fromJsx() → Takumi node
//     (2 full tree walks + 2× node allocations per render)
//
//   Bypass path (used here):
//     VNode → vnodeToTakumiNode() → Takumi node
//     (1 tree walk, saves ~1–5ms per frame)
//
// The mapping handles three VNode types:
//   #text  → Takumi TextNode { type: "text", text }
//   img    → Takumi ImageNode { type: "image", src }
//   svg    → Takumi ImageNode { type: "image", src: "<svg>...</svg>" }
//   *      → Takumi ContainerNode { type: "container", children }
//
// className → tw mapping replicates what vnodeToElement() does for
// Takumi's built-in Tailwind CSS parser.

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

  const { children: _children, className, src, ...restProps } = node.props;

  // Map className → tw (same logic as vnodeToElement)
  let tw: string | undefined = typeof restProps.tw === "string" ? restProps.tw : undefined;
  if (typeof className === "string" && className.length > 0) {
    tw = tw ? tw + " " + className : className;
  }

  // Image nodes → Takumi ImageNode
  if (node.type === "img" && typeof src === "string") {
    return {
      type: "image",
      src: src as string,
      ...(tw ? { tw } : {}),
      ...restProps,
    } as TakumiNode;
  }

  // SVG nodes → Takumi ImageNode (serialize subtree to SVG markup)
  // Mirrors fromJsx()'s SVG handling: the entire <svg> subtree is serialized
  // to an SVG markup string and wrapped in an ImageNode.
  if (node.type === "svg") {
    const svgMarkup = serializeSvgTree(node);
    const width = typeof node.props.width === "number" ? node.props.width : undefined;
    const height = typeof node.props.height === "number" ? node.props.height : undefined;
    return {
      type: "image",
      src: svgMarkup,
      ...(width != null ? { width } : {}),
      ...(height != null ? { height } : {}),
      ...(tw ? { tw } : {}),
      ...(node.props.style ? { style: node.props.style } : {}),
      tagName: "svg",
    } as TakumiNode;
  }

  // All other nodes → Takumi ContainerNode
  const takumiChildren =
    node.children.length > 0
      ? node.children.map((child) => vnodeToTakumiNode(child, depth + 1))
      : undefined;

  return {
    type: "container",
    ...(tw ? { tw } : {}),
    ...restProps,
    ...(takumiChildren ? { children: takumiChildren } : {}),
  } as TakumiNode;
}

/** Build the root Takumi container wrapping the VNode children. */
function buildTakumiRoot(container: VContainer): TakumiNode {
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
  times: { t0: number; t1: number; t2: number; t3: number; t4: number; t5: number },
  opts: { skipped: boolean; cacheHit: boolean; container: VContainer },
): void {
  const stats = measureTree(opts.container.children);
  const cache = config.imageCacheMaxBytes > 0 ? getImageCache(config.imageCacheMaxBytes) : null;
  config.onProfile!({
    vnodeToElementMs: times.t1 - times.t0,
    fromJsxMs: times.t2 - times.t1,
    takumiRenderMs: times.t3 - times.t2,
    hashMs: times.t4 - times.t3,
    base64Ms: times.t5 - times.t4,
    totalMs: times.t5 - times.t0,
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

  metrics.recordFlush();

  // Pre-render skip: if no VNode was mutated since last flush, skip entirely
  if (config.caching && !isContainerDirty(container)) {
    metrics.recordDirtySkip();
    return null;
  }

  const profiling = config.onProfile != null;
  const t0 = profiling ? performance.now() : 0;
  let t1 = t0;
  let t2 = t0;
  let t3 = t0;

  // ── Image Cache Lookup (Phase 3) ──────────────────────────────
  // Compute Merkle hash of the VNode tree. If cached, skip the entire
  // Takumi render pipeline and return the cached data URI.
  if (config.caching && config.imageCacheMaxBytes > 0) {
    const treeHash = computeTreeHash(container);
    const cacheKey = computeCacheKey(
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
      metrics.recordCacheHit();
      if (profiling) {
        const tNow = performance.now();
        emitProfile(
          config,
          { t0, t1: tNow, t2: tNow, t3: tNow, t4: tNow, t5: tNow },
          {
            skipped: false,
            cacheHit: true,
            container,
          },
        );
      }
      container._dupCount = 0;
      config.onRender?.(container, cached);
      clearDirtyFlags(container);
      return cached;
    }
  }

  // ── Render (worker or main thread) ─────────────────────────────
  let buffer: Buffer | Uint8Array;

  if (config.renderPool?.isAvailable) {
    // Worker path: vnodeToElement + fromJsx + render all happen in the worker.
    // Sub-stage timing is not available in worker mode.
    buffer = await config.renderPool.render(
      container.children,
      width,
      height,
      config.imageFormat,
      config.devicePixelRatio,
    );
    t3 = profiling ? performance.now() : 0;
    t1 = t0; // no sub-stage data
    t2 = t0;
  } else {
    // Main-thread path: VNode → Takumi node (direct bypass, skips fromJsx)
    // 1. Convert VNode tree → Takumi nodes directly
    const rootNode = buildTakumiRoot(container);

    t1 = profiling ? performance.now() : 0;
    t2 = t1; // no fromJsx step in bypass mode

    // 2. Render to raster image
    buffer = await config.renderer.render(rootNode, {
      width,
      height,
      format: config.imageFormat,
      devicePixelRatio: config.devicePixelRatio,
    });

    t3 = profiling ? performance.now() : 0;
  }

  // 4. Cache check — skip if identical to last render (post-render dedup)
  if (config.caching) {
    const hash = fnv1a(buffer);
    if (hash === container.lastSvgHash) {
      metrics.recordHashDedup();
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
        const t4 = performance.now();
        emitProfile(
          config,
          { t0, t1, t2, t3, t4, t5: t4 },
          {
            skipped: true,
            cacheHit: false,
            container,
          },
        );
      }

      clearDirtyFlags(container);
      return null; // No change
    }
    container.lastSvgHash = hash;
    container._dupCount = 0;
  }

  const t4 = profiling ? performance.now() : 0;

  const dataUri = bufferToDataUri(buffer, config.imageFormat);

  const t5 = profiling ? performance.now() : 0;

  // ── Store in image cache ──────────────────────────────────────
  if (config.caching && config.imageCacheMaxBytes > 0) {
    const treeHash = computeTreeHash(container);
    const cacheKey = computeCacheKey(
      treeHash,
      width,
      height,
      config.devicePixelRatio,
      config.imageFormat,
    );
    const cache = getImageCache(config.imageCacheMaxBytes);
    // Approximate byte size: dataUri string length × 2 (UTF-16) + overhead
    cache.set(cacheKey, dataUri, dataUri.length * 2 + 64);
  }

  // Record render for metrics (t3-t0 includes full render pipeline)
  metrics.recordRender(t3 - t0);

  if (profiling) {
    emitProfile(
      config,
      { t0, t1, t2, t3, t4, t5 },
      {
        skipped: false,
        cacheHit: false,
        container,
      },
    );
  }

  config.onRender?.(container, dataUri);
  clearDirtyFlags(container);
  return dataUri;
}
// ── Render to Raw RGBA ──────────────────────────────────────────────
//
// TouchBar-specific entry point.  Produces raw RGBA pixels (no PNG/WebP
// encoding overhead) for a single full-width render of the component
// tree.  The caller (TouchBarRoot.doFlush) then crops per-encoder
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
//   - Uses the touchbar LRU cache (separate size budget)
//   - No base64 encoding step — raw RGBA is returned directly
//   - Profile timing: t2 (fromJsx) is aliased to t1 (no fromJsx step
//     in the VNode→Takumi bypass), and t4/t5 (hash+base64) collapse
//     to a single endpoint since there's no base64 encoding.
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
//                                       emitTouchBarRender()
//                                         │ SSE "render:touchbar"
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

  metrics.recordFlush();

  // ── Phase 1: Dirty-flag check ─────────────────────────────────
  // If no VNode was mutated since last flush, skip entirely.
  // Cost: O(1) — just a boolean check on the container.
  if (config.caching && !isContainerDirty(container)) {
    metrics.recordDirtySkip();
    return null;
  }

  // ── Profiling setup ───────────────────────────────────────────
  // Timing variables mirror renderToDataUri() for consistency:
  //
  //   t0 ── start
  //   t1 ── after VNode→Takumi node conversion (vnodeToElementMs)
  //   t2 ── after fromJsx (aliased to t1; no fromJsx in bypass mode)
  //   t3 ── after Takumi renderer.render() (takumiRenderMs)
  //   t4 ── after hash check (hashMs; aliased to t5 for raw — no base64)
  //   t5 ── end (base64Ms = 0 for raw renders)
  const profiling = config.onProfile != null;
  const t0 = profiling ? performance.now() : 0;
  let t1 = t0;
  let t3 = t0;

  // ── Phase 2: TouchBar Cache Lookup ────────────────────────────
  // Compute Merkle hash of the VNode tree + render config params.
  // If found in the touchbar-specific LRU cache, skip the Takumi
  // render and return the cached raw RGBA buffer directly.
  if (config.caching && config.touchbarCacheMaxBytes > 0) {
    const treeHash = computeTreeHash(container);
    const cacheKey = computeCacheKey(treeHash, width, height, config.devicePixelRatio, "raw");
    const cache = getTouchbarCache(config.touchbarCacheMaxBytes);
    const cached = cache.get(cacheKey);

    if (cached !== undefined) {
      metrics.recordCacheHit();
      if (profiling) {
        // All stages collapsed to a single instant — render was skipped.
        const tNow = performance.now();
        emitProfile(
          config,
          { t0, t1: tNow, t2: tNow, t3: tNow, t4: tNow, t5: tNow },
          { skipped: false, cacheHit: true, container },
        );
      }
      clearDirtyFlags(container);
      return { buffer: cached, width, height };
    }
  }

  // ── Phase 3: Takumi Render (raw RGBA) ─────────────────────────
  // Either offloaded to a worker thread or run on the main thread
  // using the VNode→Takumi node bypass (skips createElement + fromJsx).
  let buffer: Buffer | Uint8Array;

  if (config.renderPool?.isAvailable) {
    // Worker path: all conversion + render happens in the worker.
    // Sub-stage timing (vnodeToElement vs takumiRender) is not
    // available — the worker reports only total render time.
    buffer = await config.renderPool.render(
      container.children,
      width,
      height,
      "raw",
      config.devicePixelRatio,
    );
    t3 = profiling ? performance.now() : 0;
    t1 = t0; // no sub-stage data in worker mode
  } else {
    // Main-thread path: VNode → Takumi node (direct bypass)
    const rootNode = buildTakumiRoot(container);

    t1 = profiling ? performance.now() : 0;

    buffer = await config.renderer.render(rootNode, {
      width,
      height,
      format: "raw" as OutputFormat,
      devicePixelRatio: config.devicePixelRatio,
    });

    t3 = profiling ? performance.now() : 0;
  }

  // ── Phase 4: FNV-1a Output Dedup ──────────────────────────────
  // Hash the raw raster buffer.  If identical to the previous frame,
  // skip — the component re-rendered but produced no visual change.
  if (config.caching) {
    const hash = fnv1a(buffer);
    if (hash === container.lastSvgHash) {
      metrics.recordHashDedup();
      if (profiling) {
        // Render ran but output was identical — skipped: true.
        // No base64 step for raw renders, so t4 == t5.
        const t4 = performance.now();
        emitProfile(
          config,
          { t0, t1, t2: t1, t3, t4, t5: t4 },
          { skipped: true, cacheHit: false, container },
        );
      }
      clearDirtyFlags(container);
      return null; // No change
    }
    container.lastSvgHash = hash;
  }

  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

  // ── Store in touchbar cache ───────────────────────────────────
  // Cache the raw RGBA buffer for future Merkle-hash hits.
  // byteLength + 64 accounts for Map/LRU overhead.
  if (config.caching && config.touchbarCacheMaxBytes > 0) {
    const treeHash = computeTreeHash(container);
    const cacheKey = computeCacheKey(treeHash, width, height, config.devicePixelRatio, "raw");
    const cache = getTouchbarCache(config.touchbarCacheMaxBytes);
    cache.set(cacheKey, buf, buf.byteLength + 64);
  }

  // Record render for metrics.
  // Duration covers VNode conversion + Takumi render (t3 - t0).
  // No base64 step for raw renders.
  metrics.recordRender(t3 - t0);

  if (profiling) {
    // Emit profile with t2=t1 (no fromJsx) and t4=t5=tEnd (no base64).
    const tEnd = performance.now();
    emitProfile(
      config,
      { t0, t1, t2: t1, t3, t4: tEnd, t5: tEnd },
      { skipped: false, cacheHit: false, container },
    );
  }

  clearDirtyFlags(container);
  return { buffer: buf, width, height };
}

// ── Raw Buffer Crop ─────────────────────────────────────────────────
// Extracts a rectangular slice from a raw RGBA buffer (row-major order).
// Used by the touchbar pipeline to cut per-encoder segments from a
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
// Uses the buffer pool to avoid GC pressure during 60fps animation —
// the caller MUST release the returned buffer via pool.release().

export function cropSlice(
  raw: Buffer,
  fullWidth: number,
  column: number,
  segmentWidth: number,
  segmentHeight: number,
): Buffer {
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

// ── Async Slice to Data URI ─────────────────────────────────────────
// Async variant that offloads deflate compression to the libuv thread
// pool (via zlib.deflate).  When multiple touchbar segments are encoded
// in parallel via Promise.all, each deflate runs on a separate libuv
// worker — effectively parallelizing the most expensive step of PNG
// encoding across CPU cores.

export async function sliceToDataUriAsync(
  raw: Buffer,
  fullWidth: number,
  fullHeight: number,
  column: number,
  segmentWidth: number,
  segmentHeight: number,
): Promise<string> {
  const cropped = cropSlice(raw, fullWidth, column, segmentWidth, segmentHeight);
  const png = await encodePngAsync(segmentWidth, segmentHeight, cropped);
  // Release the crop buffer back to the pool after encoding
  getBufferPool().release(cropped);
  return bufferToDataUri(png, "png");
}

// ── Render Segment to Data URI (native format) ─────────────────────
// Alternative touchbar rendering path that bypasses raw→crop→PNG entirely.
// Each encoder segment gets its own independent Takumi render call using
// a CSS negative-margin viewport offset to extract the correct portion:
//
//   ┌─────────────────────────────────────────────┐
//   │           Full-width component tree          │
//   │  ┌─────────┐                                │
//   │  │ segment  │◄─ marginLeft: -(col * 200)     │
//   │  │ 200×100  │   overflow: hidden             │
//   │  └─────────┘                                │
//   └─────────────────────────────────────────────┘
//
// This is faster than raw→crop→deflate when using WebP output
// (Takumi encodes WebP natively in the render call itself).

export async function renderSegmentToDataUri(
  container: VContainer,
  fullWidth: number,
  segmentHeight: number,
  column: number,
  segmentWidth: number,
  format: OutputFormat,
  config: RenderConfig,
): Promise<string | null> {
  if (container.children.length === 0) return null;

  // Build the root Takumi node with an X offset to extract the right segment
  const children = container.children.map(vnodeToTakumiNode);
  const innerNode: TakumiNode = {
    type: "container",
    style: {
      ...ROOT_STYLE,
      width: fullWidth,
      height: segmentHeight,
      marginLeft: -(column * segmentWidth),
    },
    children,
  } as TakumiNode;

  // Clip to segment bounds
  const clipNode: TakumiNode = {
    type: "container",
    style: {
      width: segmentWidth,
      height: segmentHeight,
      overflow: "hidden",
    },
    children: [innerNode],
  } as TakumiNode;

  const buffer = await config.renderer.render(clipNode, {
    width: segmentWidth,
    height: segmentHeight,
    format,
    devicePixelRatio: config.devicePixelRatio,
  });

  return bufferToDataUri(buffer, format);
}
