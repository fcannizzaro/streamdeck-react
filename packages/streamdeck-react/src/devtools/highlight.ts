import { createElement } from "react";
import { fromJsx } from "@takumi-rs/helpers/jsx";
import type { MeasuredNode } from "@takumi-rs/core";
import { vnodeToElement, type VContainer, type VNode } from "@/reconciler/vnode";
import { bufferToDataUri, type RenderConfig } from "@/render/pipeline";

// ── Highlight Overlay Renderer ──────────────────────────────────────
//
// Re-renders a VNode tree with a Chrome DevTools-style highlight on a
// specific node (matched by its serialization nid).
//
// How it works:
//   1. Build the normal React element tree (vnodeToElement)
//   2. Convert to Takumi nodes and measure layout (renderer.measure)
//   3. Walk VNode and MeasuredNode trees in parallel to find the
//      target node's absolute pixel bounds
//   4. Rebuild the tree with an absolutely-positioned overlay div
//      at the measured bounds
//   5. Render the final image with the overlay
//
// The overlay is placed at the root level with `position: absolute`,
// so it renders on top of all content (including images) without
// modifying any existing element's style or positioning context.
//
// Intentionally skips caching and the onRender callback to avoid
// feedback loops (the bridge would see the highlight as a new render,
// which would trigger another highlight, etc.).
//
// #text node handling:
//   Text nodes can't carry styles in the renderer.  When the devtools
//   UI targets a #text node, resolveTargetNid promotes the highlight
//   to its parent element node instead.

const HIGHLIGHT_BORDER_COLOR = "rgba(111, 168, 220, 0.85)";
const HIGHLIGHT_BORDER_WIDTH = 2;
const HIGHLIGHT_BG = "rgba(111, 168, 220, 0.66)";
const HIGHLIGHT_BOX_SHADOW = `inset 0 0 0 ${HIGHLIGHT_BORDER_WIDTH}px ${HIGHLIGHT_BORDER_COLOR}`;

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function renderWithHighlight(
  container: VContainer,
  width: number,
  height: number,
  config: RenderConfig,
  targetNid: number,
): Promise<string | null> {
  if (container.children.length === 0) return null;

  // If the target is a #text node, highlight its parent element instead —
  // bare text can't carry styles in the renderer.
  const effectiveNid = resolveTargetNid(container, targetNid);

  // 1. Build the normal React element tree (no highlight modifications).
  const rootChildren = container.children.map(vnodeToElement);
  const rootElement = createElement(
    "div",
    {
      style: {
        display: "flex",
        position: "relative",
        width: "100%",
        height: "100%",
      },
    },
    ...rootChildren,
  );

  // 2. Convert to Takumi nodes and measure layout.
  const { node, stylesheets } = await fromJsx(rootElement);
  const renderOpts = {
    width,
    height,
    stylesheets,
    devicePixelRatio: config.devicePixelRatio,
  };
  const measured = await config.renderer.measure(node, renderOpts);

  // 3. Find the target node's absolute bounds by walking VNode and
  //    MeasuredNode trees in parallel.  nid 0 = the container wrapper
  //    (which maps to the root MeasuredNode), children start at nid 1.
  const counter = { value: 0 };
  counter.value++; // skip container (nid 0)
  const bounds = findTargetBounds(
    container.children,
    measured.children,
    effectiveNid,
    counter,
    measured.transform[4],
    measured.transform[5],
  );

  if (!bounds) return null;

  // 4. Build the tree again, this time with the overlay appended at root.
  const overlay = createElement("div", {
    style: {
      position: "absolute",
      top: bounds.y,
      left: bounds.x,
      width: bounds.width,
      height: bounds.height,
      backgroundColor: HIGHLIGHT_BG,
      boxShadow: HIGHLIGHT_BOX_SHADOW,
    },
  });

  const highlightedRoot = createElement(
    "div",
    {
      style: {
        display: "flex",
        position: "relative",
        width: "100%",
        height: "100%",
      },
    },
    ...rootChildren,
    overlay,
  );

  // 5. Render the final image with the overlay.
  const { node: hlNode, stylesheets: hlStylesheets } = await fromJsx(highlightedRoot);
  const buffer = await config.renderer.render(hlNode, {
    ...renderOpts,
    format: config.imageFormat,
    stylesheets: hlStylesheets,
  });

  return bufferToDataUri(buffer, config.imageFormat);
}

// ── Find target bounds via parallel VNode / MeasuredNode walk ────────
// Walks VNode children and MeasuredNode children in lockstep.
// Text VNodes (#text) don't produce MeasuredNode children — they are
// absorbed into the parent's text runs.  So the measured child index
// only advances for element VNodes, while the nid counter advances
// for every VNode (including text).  This mismatch is why the walk
// must track both indices independently.

function findTargetBounds(
  vnodes: VNode[],
  measuredChildren: MeasuredNode[],
  targetNid: number,
  counter: { value: number },
  parentX: number,
  parentY: number,
): Bounds | null {
  let measuredIdx = 0;

  for (const vnode of vnodes) {
    const nid = counter.value++;

    if (vnode.type === "#text") {
      // Text nodes have no corresponding MeasuredNode entry.
      continue;
    }

    const measured = measuredChildren[measuredIdx++];
    if (!measured) continue;

    const absX = parentX + measured.transform[4];
    const absY = parentY + measured.transform[5];

    if (nid === targetNid) {
      return { x: absX, y: absY, width: measured.width, height: measured.height };
    }

    // Recurse into children
    const found = findTargetBounds(
      vnode.children,
      measured.children,
      targetNid,
      counter,
      absX,
      absY,
    );
    if (found) return found;
  }

  return null;
}

// ── Text-node target resolver ───────────────────────────────────────
// #text nodes can't carry styles.  When the devtools UI targets a text
// node, we promote the highlight to its parent element.

function resolveTargetNid(container: VContainer, targetNid: number): number {
  const counter = { value: 0 };
  counter.value++; // skip container (nid 0)
  for (const child of container.children) {
    const resolved = resolveInSubtree(child, targetNid, counter, 0);
    if (resolved !== null) return resolved;
  }
  return targetNid;
}

function resolveInSubtree(
  node: VNode,
  targetNid: number,
  counter: { value: number },
  parentNid: number,
): number | null {
  const nid = counter.value++;
  if (nid === targetNid) {
    return node.type === "#text" ? parentNid : nid;
  }
  if (node.type === "#text") return null;
  for (const child of node.children) {
    const resolved = resolveInSubtree(child, targetNid, counter, nid);
    if (resolved !== null) return resolved;
  }
  return null;
}
