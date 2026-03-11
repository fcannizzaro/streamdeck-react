import type { OutputFormat } from "@takumi-rs/core";
import type { Node as TakumiNode } from "@takumi-rs/helpers";
import type { VContainer, VNode } from "@/reconciler/vnode";
import { buildTakumiRoot, bufferToDataUri, type RenderConfig } from "@/render/pipeline";

// ── Highlight Overlay Renderer ──────────────────────────────────────
//
// Re-renders a VNode tree with a Chrome DevTools-style highlight on a
// specific node (matched by its serialization nid).
//
// CRITICAL DESIGN DECISION — "inject into target" approach:
//
//   Earlier iterations used renderer.measure() to compute the target
//   node's pixel bounds, then placed an overlay TakumiNode at those
//   absolute coordinates (either as a sibling or in a wrapper).  This
//   caused persistent misalignment because measure() and render() can
//   produce subtly different layouts — even for the same tree — due
//   to internal rounding, sub-pixel handling, or layout resolution
//   differences in the Takumi renderer.
//
//   The current approach eliminates ALL coordinate math:
//
//     1. Build the Takumi tree using buildTakumiRoot() (same conversion
//        as the normal render pipeline).
//     2. Walk the VNode tree and Takumi tree IN PARALLEL to find the
//        Takumi node corresponding to the target nid.
//     3. Inject the highlight overlay as a CHILD of the target node:
//        - Add `position: "relative"` to the target's style (establishes
//          positioning context; doesn't change its layout position)
//        - Push an overlay child with `position: "absolute"` covering
//          the full area (top: 0, left: 0, width: "100%", height: "100%")
//     4. Render the modified tree.
//
//   Why this guarantees pixel-perfect alignment:
//
//     ┌─ target node (now position: relative) ────────────────┐
//     │                                                        │
//     │  ┌─ existing children ──────────────────────────────┐  │
//     │  │  (layout unchanged — position: relative is a     │  │
//     │  │   no-op for in-flow elements in flex/block)      │  │
//     │  └──────────────────────────────────────────────────┘  │
//     │                                                        │
//     │  ┌─ overlay (position: absolute, inset: 0) ─────────┐ │
//     │  │  100% × 100% of the target's content box          │ │
//     │  │  Renders ON TOP (last child, absolutely positioned)│ │
//     │  └──────────────────────────────────────────────────┘  │
//     │                                                        │
//     └────────────────────────────────────────────────────────┘
//
//     The overlay covers EXACTLY the target element because it
//     inherits its dimensions (100% × 100%) and is positioned at
//     (0, 0) relative to the target's content box.  No measure(),
//     no transform accumulation, no coordinate mismatch possible.
//
// Leaf node handling:
//   #text → resolveTargetNid() promotes to the parent container
//           (text nodes can't carry styles or children).
//   img/svg → these map to Takumi ImageNode which can't carry children,
//           but instead of promoting to the parent, we WRAP the
//           ImageNode in a container with the overlay.  This gives a
//           precise highlight covering just the image/SVG area.
//   SVG descendants (path, circle, g, etc.) → promoted to SVG's
//           parent container because they have no individual Takumi
//           representation (the entire SVG subtree is one ImageNode).
//
// Intentionally skips caching and the onRender callback to avoid
// feedback loops (the bridge would see the highlight as a new render,
// which would trigger another highlight, etc.).

const HIGHLIGHT_BG = "rgba(111, 168, 220, 0.66)";
const HIGHLIGHT_BORDER_COLOR = "rgba(111, 168, 220, 0.85)";
const HIGHLIGHT_BORDER_WIDTH = 2;
const HIGHLIGHT_BOX_SHADOW = `inset 0 0 0 ${HIGHLIGHT_BORDER_WIDTH}px ${HIGHLIGHT_BORDER_COLOR}`;

// ── Key/Dial Highlight ──────────────────────────────────────────────

export async function renderWithHighlight(
  container: VContainer,
  width: number,
  height: number,
  config: RenderConfig,
  targetNid: number,
): Promise<string | null> {
  if (container.children.length === 0) return null;

  const effectiveNid = resolveTargetNid(container, targetNid);

  // 1. Build a fresh Takumi tree using the SAME conversion path as
  //    the normal render pipeline.  This tree is local to this call
  //    and safe to mutate (buildTakumiRoot creates new objects).
  const rootNode = buildTakumiRoot(container);

  // 2. Walk VNode + Takumi trees in parallel to find the target.
  //    The Takumi tree mirrors the VNode tree 1:1 (including text
  //    nodes), so we can walk them in lockstep using nid counting.
  const counter = { value: 0 };
  counter.value++; // skip container (nid 0)
  const target = findTargetTakumiNode(
    container.children,
    (rootNode as AnyTakumiNode).children ?? [],
    effectiveNid,
    counter,
  );

  if (!target) return null;

  // 3. Inject the highlight overlay into the target node.
  injectHighlightOverlay(target);

  // 4. Render the modified tree.  Layout is identical to the normal
  //    render except the target node has an overlay child.
  const buffer = await config.renderer.render(rootNode, {
    width,
    height,
    format: config.imageFormat,
    devicePixelRatio: config.devicePixelRatio,
  });

  return bufferToDataUri(buffer, config.imageFormat);
}

// ── TouchStrip Highlight ──────────────────────────────────────────────
//
// Renders the touchstrip tree with a highlight overlay.  Re-renders ALL
// segments (not just affected ones) because the inject approach
// guarantees identical layout for non-highlighted segments — the only
// difference is the overlay child in the target node.
//
// Returns:
//   - segmentUris: Map<column, dataUri> for ALL segments
//   - fullUri: full-width data URI for the devtools browser preview
//
//   renderTouchStripWithHighlight()
//     │
//     ├─ buildTakumiRoot(container) → rootNode
//     ├─ findTargetTakumiNode → inject overlay into target
//     ├─ Render full width → fullUri (browser preview)
//     │
//     └─ For each column:
//          ├─ Clip wrapper with marginLeft offset (same as renderSegmentToDataUri)
//          └─ renderer.render → segment data URI

export interface TouchStripHighlightResult {
  /** Per-column data URIs for ALL segments. */
  segmentUris: Map<number, string>;
}

export async function renderTouchStripWithHighlight(
  container: VContainer,
  fullWidth: number,
  segmentHeight: number,
  columns: number[],
  segmentWidth: number,
  format: OutputFormat,
  config: RenderConfig,
  targetNid: number,
): Promise<TouchStripHighlightResult | null> {
  if (container.children.length === 0) return null;

  const effectiveNid = resolveTargetNid(container, targetNid);

  // 1. Build a fresh Takumi tree (safe to mutate).
  const rootNode = buildTakumiRoot(container);

  // 2. Find and inject highlight overlay into the target.
  const counter = { value: 0 };
  counter.value++; // skip container (nid 0)
  const target = findTargetTakumiNode(
    container.children,
    (rootNode as AnyTakumiNode).children ?? [],
    effectiveNid,
    counter,
  );

  if (!target) return null;

  injectHighlightOverlay(target);

  // 3. Render per-segment data URIs for hardware push AND browser
  //    preview.  Uses the same clip approach as renderSegmentToDataUri()
  //    in pipeline.ts: wrap the full-width tree in a clip container with
  //    a negative marginLeft to extract each column's slice.
  //
  //    Each segment is rendered independently at 200×100.  For segments
  //    that don't contain the highlighted element, the render output is
  //    identical to the normal pipeline.  The bridge broadcasts these
  //    per-segment URIs individually so the devtools preview replaces
  //    each segment image separately (avoids the scaling issues that
  //    a single full-width image causes in the preview panel).
  const segmentUris = new Map<number, string>();
  const segmentPromises = columns.map(async (column) => {
    const clipNode: TakumiNode = {
      type: "container",
      style: {
        width: segmentWidth,
        height: segmentHeight,
        overflow: "hidden",
      },
      children: [
        {
          type: "container",
          style: {
            display: "flex",
            width: fullWidth,
            height: segmentHeight,
            marginLeft: -(column * segmentWidth),
          },
          // rootNode already has the overlay injected into the target.
          // For segments that don't contain the highlighted element,
          // the render output is identical to the normal pipeline.
          children: (rootNode as AnyTakumiNode).children,
        } as TakumiNode,
      ],
    } as TakumiNode;

    const segBuffer = await config.renderer.render(clipNode, {
      width: segmentWidth,
      height: segmentHeight,
      format,
      devicePixelRatio: config.devicePixelRatio,
    });
    segmentUris.set(column, bufferToDataUri(segBuffer, format));
  });
  await Promise.all(segmentPromises);

  return { segmentUris };
}

// ── Highlight Overlay Injection ─────────────────────────────────────
//
// Adds a highlight overlay to the target Takumi node.  Two strategies
// depending on the node type:
//
//   ContainerNode (div, span, Box, etc.):
//     Inject overlay as last child + add position: relative to style.
//     This is a no-op for layout (position: relative doesn't move
//     in-flow elements) and the overlay covers exactly the container.
//
//     Before:  target { style: { ... }, children: [A, B, C] }
//     After:   target { style: { ..., position: relative }, children: [A, B, C, overlay] }
//
//   ImageNode / TextNode (img, svg, #text):
//     Cannot carry children.  Instead, WRAP the node in a container
//     with position: relative and add the overlay as a sibling.
//     The wrapper sizes to its content (the original node), so the
//     overlay covers exactly the image/text area.
//
//     Before:  parent.children: [..., ImageNode, ...]
//     After:   parent.children: [..., wrapper { position: relative, children: [ImageNode, overlay] }, ...]

function injectHighlightOverlay(target: HighlightTarget): void {
  const node = target.node as AnyTakumiNode;

  // Create the overlay: covers the full target area, renders
  // on top of existing children (last in paint order).
  const overlay: TakumiNode = {
    type: "container",
    style: {
      position: "absolute",
      top: 0,
      left: 0,
      width: "100%",
      height: "100%",
      backgroundColor: HIGHLIGHT_BG,
      boxShadow: HIGHLIGHT_BOX_SHADOW,
    },
  } as TakumiNode;

  if (node.type === "container") {
    // Container: inject overlay as child, set position: relative
    // to establish a positioning context for the overlay.
    node.style = { ...(node.style ?? {}), position: "relative" };
    if (!node.children) {
      node.children = [];
    }
    node.children.push(overlay);
  } else {
    // Leaf node (image, text): wrap in a container with overlay.
    // The wrapper inherits the node's position in the parent's
    // children array.  It sizes to its content (the original node),
    // so the overlay covers exactly the image/text area.
    const wrapper: TakumiNode = {
      type: "container",
      style: { position: "relative" },
      children: [target.node, overlay],
    } as TakumiNode;
    target.parentChildren[target.indexInParent] = wrapper;
  }
}

// ── Takumi Node Type Helpers ────────────────────────────────────────
// TakumiNode from @takumi-rs/helpers is a union of TextNode,
// ImageNode, ContainerNode, etc.  For tree walking we need to access
// .children (which only exists on ContainerNode) and .style.
// This interface provides untyped access for the walk/inject logic.

interface AnyTakumiNode {
  type: string;
  style?: Record<string, unknown>;
  children?: TakumiNode[];
  [key: string]: unknown;
}

// ── Highlight Target ────────────────────────────────────────────────
//
// Result of findTargetTakumiNode().  Contains the target node plus
// its parent and index, which are needed for the wrapping strategy
// used on non-container nodes (image, text).
//
//   Container targets:  overlay injected as child (no parent needed)
//   Image targets:      wrapped in a container at parent.children[index]

interface HighlightTarget {
  /** The Takumi node to highlight. */
  node: TakumiNode;
  /** The parent's children array that contains the target. */
  parentChildren: TakumiNode[];
  /** Index of the target node within parentChildren. */
  indexInParent: number;
}

// ── Parallel VNode / Takumi Tree Walk ───────────────────────────────
//
// Walks the VNode tree and Takumi node tree IN PARALLEL to find the
// Takumi node corresponding to a given nid.
//
// The two trees are structurally 1:1 at the TOP level because
// buildTakumiRoot() maps each VNode child to exactly one Takumi node:
//
//   VNode #text  → TakumiNode { type: "text" }
//   VNode img    → TakumiNode { type: "image" }
//   VNode svg    → TakumiNode { type: "image" }  ← ENTIRE subtree collapsed!
//   VNode *      → TakumiNode { type: "container", children: [...] }
//
// IMPORTANT — SVG subtree collapse:
//
//   vnodeToTakumiNode() serializes an entire <svg> subtree (svg, path,
//   circle, g, etc.) into a SINGLE Takumi ImageNode with the SVG markup
//   as a string.  The Takumi tree has NO children for SVG nodes.
//
//   But the VNode serializer (serializeVNode) DOES walk into SVG
//   children and assigns nids to them.  This means:
//
//     VNode tree:           Takumi tree:
//     ───────────           ────────────
//     svg (nid 2)           ImageNode (idx 0) ← no children
//       path (nid 3)
//       circle (nid 4)
//     span (nid 5)          ContainerNode (idx 1)
//
//   If we skip SVG children without advancing the counter, nid 5
//   (span) would get counter value 3 — desynchronizing all subsequent
//   nids.  We MUST call advanceCounterThroughSubtree() to count all
//   SVG descendants even though we don't recurse into Takumi children.

function findTargetTakumiNode(
  vnodes: VNode[],
  takumiNodes: TakumiNode[],
  targetNid: number,
  counter: { value: number },
): HighlightTarget | null {
  let idx = 0;

  for (const vnode of vnodes) {
    const nid = counter.value++;
    const takumiNode = takumiNodes[idx];
    idx++;
    if (!takumiNode) continue;

    if (nid === targetNid) {
      return { node: takumiNode, parentChildren: takumiNodes, indexInParent: idx - 1 };
    }

    // #text and img are true leaf nodes — no VNode children, no
    // Takumi children.  Nothing to recurse or advance through.
    if (vnode.type === "#text" || vnode.type === "img") {
      continue;
    }

    // SVG VNodes have children (path, circle, g, etc.) in the VNode
    // tree, but they collapse to a single Takumi ImageNode with NO
    // children.  We must advance the counter through all SVG
    // descendants to keep nid numbering in sync with the serializer,
    // but we do NOT recurse into Takumi children (there are none).
    if (vnode.type === "svg") {
      advanceCounterThroughSubtree(vnode.children, counter);
      continue;
    }

    const childTakumiNodes = (takumiNode as AnyTakumiNode).children ?? [];
    const found = findTargetTakumiNode(vnode.children, childTakumiNodes, targetNid, counter);
    if (found) return found;
  }

  return null;
}

// ── Counter Advancement ─────────────────────────────────────────────
//
// Advances the nid counter through an entire VNode subtree without
// looking for targets or Takumi nodes.  Used when a VNode subtree
// has been collapsed into a single Takumi node (SVG → ImageNode)
// but the serializer assigned nids to all descendants.
//
// Must count EVERY VNode (including #text) to match the serializer's
// depth-first nid assignment.

function advanceCounterThroughSubtree(vnodes: VNode[], counter: { value: number }): void {
  for (const node of vnodes) {
    counter.value++;
    advanceCounterThroughSubtree(node.children, counter);
  }
}

// ── Leaf-node target resolver ───────────────────────────────────────
//
// Determines the effective nid to highlight.  Some VNode types map to
// Takumi nodes that can't be highlighted directly:
//
//   #text → Takumi TextNode: no children, no style.  Promote to the
//           nearest parent ContainerNode.
//
//   img/svg → Takumi ImageNode: no children, but CAN be wrapped in a
//           container with an overlay by injectHighlightOverlay().
//           These are NOT promoted — their own nid is returned.
//
//   SVG descendants (path, circle, g, etc.) → these VNodes have NO
//           individual Takumi representation (the entire SVG subtree
//           is collapsed into one ImageNode).  Promote to the SVG
//           node's nid so the wrapping targets the SVG ImageNode.
//
//     <Box>           ← nid 1 (ContainerNode)
//       <svg>         ← nid 2 (ImageNode) ← SVG descendants promote here
//         <path/>     ← nid 3 (no Takumi node)
//         <circle/>   ← nid 4 (no Takumi node)
//       <Text/>       ← nid 5 (ContainerNode)
//
//   Hovering nid 3 or 4 → effective nid = 2 (svg ImageNode, wrapped)
//   Hovering nid 2       → effective nid = 2 (svg ImageNode, wrapped)
//   Hovering nid 1       → effective nid = 1 (Box container, injected)
//
// This walks the VNode tree (not the Takumi tree) because VNode.type
// directly tells us whether the node is a leaf.

function resolveTargetNid(container: VContainer, targetNid: number): number {
  const counter = { value: 0 };
  counter.value++; // skip container (nid 0)
  for (const child of container.children) {
    const resolved = resolveInSubtree(child, targetNid, counter, 0, false);
    if (resolved !== null) return resolved;
  }
  return targetNid;
}

function resolveInSubtree(
  node: VNode,
  targetNid: number,
  counter: { value: number },
  parentNid: number,
  insideSvg: boolean,
): number | null {
  const nid = counter.value++;
  if (nid === targetNid) {
    // #text → promote to parent (can't wrap or inject)
    // insideSvg → promote to SVG's nid (passed as parentNid)
    //             so the wrapping targets the SVG ImageNode
    // img/svg → return own nid (will be wrapped by injectHighlightOverlay)
    // container → return own nid (overlay injected as child)
    const shouldPromote = node.type === "#text" || insideSvg;
    return shouldPromote ? parentNid : nid;
  }
  // Text nodes have no VNode children to recurse into
  if (node.type === "#text") return null;

  // When entering an SVG subtree, all descendants are "inside SVG"
  // and should promote to the SVG's own nid (so the highlight targets
  // the SVG ImageNode, which will be wrapped with an overlay).
  const childInsideSvg = insideSvg || node.type === "svg";

  for (const child of node.children) {
    const resolved = resolveInSubtree(child, targetNid, counter, nid, childInsideSvg);
    if (resolved !== null) return resolved;
  }
  return null;
}
