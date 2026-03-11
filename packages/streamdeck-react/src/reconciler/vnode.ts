import { createElement, type ReactElement } from "react";

// ── VNode: Virtual DOM for the Stream Deck Reconciler ───────────────
//
// VNodes form the in-memory tree that bridges React's reconciler and
// the Takumi rasterization engine.  They serve two purposes:
//
//   1. Target for React's mutation-mode reconciler (host-config.ts
//      creates, appends, removes, and updates VNodes).
//
//   2. Input to the Merkle hash system (cache.ts computes structural
//      hashes for render dedup and image caching).
//
// Tree structure with back-pointers for dirty propagation:
//
//   VContainer (root)
//     ├─ _dirty: bool          ← set when any child mutates
//     ├─ lastSvgHash: number   ← FNV-1a of last rendered output
//     ├─ scheduledRender: bool ← microtask coalescing flag
//     └─ children: VNode[]
//          ├─ VNode { type, props, _dirty, _hash, _hashValid }
//          │    ├─ _parent ↑ (back-pointer to parent or container)
//          │    └─ children: VNode[]
//          │         └─ VNode { _parent ↑ }
//          └─ VNode ...
//
// When React mutates a VNode (commitUpdate, appendChild, etc.),
// markDirty() walks the _parent chain to the VContainer, setting
// _dirty=true and _hashValid=false on each node.  This enables:
//   - Phase 1 skip: isContainerDirty() returns false if nothing changed
//   - O(depth) Merkle re-hash: only dirty path nodes recompute hashes

export interface VNode {
  type: string;
  props: Record<string, unknown>;
  children: VNode[];
  text?: string;
  /** @internal Back-pointer to parent VNode or VContainer for dirty propagation. */
  _parent?: VNode | VContainer;
  /** @internal True when this node or a descendant has been mutated since last flush. */
  _dirty?: boolean;
  /** @internal Cached Merkle hash for this subtree. */
  _hash?: number;
  /** @internal True when `_hash` is valid (invalidated on mutation). */
  _hashValid?: boolean;
}

export interface VContainer {
  children: VNode[];
  scheduledRender: boolean;
  lastSvgHash: number;
  renderCallback: () => void;
  renderTimer: ReturnType<typeof setTimeout> | null;
  /** @internal Consecutive identical render count for duplicate detection. */
  _dupCount: number;
  /** @internal True when any child VNode has been mutated since last flush. */
  _dirty: boolean;
}

// ── Dirty Flag Propagation ──────────────────────────────────────────
// Walks the _parent chain from a mutated node up to the VContainer.
// Early-exit: if a node is already dirty, all ancestors must be too
// (previous mutation already propagated), so we stop walking.
// This keeps markDirty O(depth) in the common case and O(1) when
// multiple siblings are mutated in the same commit.

/** Mark a node (and its ancestors up to the container) as dirty. */
export function markDirty(node: VNode): void {
  let current: VNode | VContainer | undefined = node;
  while (current != null) {
    if ("_dirty" in current && current._dirty) {
      // Already dirty — ancestors must be too, stop walking.
      // Hash is also already invalid (dirty implies hashValid=false).
      break;
    }
    current._dirty = true;
    // Invalidate cached Merkle hash for VNodes (VContainer has no hash)
    if ("type" in current) {
      (current as VNode)._hashValid = false;
    }
    current = (current as VNode)._parent;
  }
}

/** Mark the container itself as dirty (for structural mutations at container level). */
export function markContainerDirty(container: VContainer): void {
  container._dirty = true;
}

/** Check if the container has any pending mutations. */
export function isContainerDirty(container: VContainer): boolean {
  return container._dirty;
}

/** Clear all dirty flags in the tree after a successful render. */
export function clearDirtyFlags(container: VContainer): void {
  container._dirty = false;
  for (const child of container.children) {
    clearNodeDirty(child);
  }
}

function clearNodeDirty(node: VNode): void {
  if (!node._dirty) return; // subtree is clean
  node._dirty = false;
  for (const child of node.children) {
    clearNodeDirty(child);
  }
}

// ── Parent Back-Pointer Management ──────────────────────────────────

/** Set back-pointer on a child node. */
export function setParent(child: VNode, parent: VNode | VContainer): void {
  child._parent = parent;
}

/** Clear back-pointer (e.g., when removing from tree). */
export function clearParent(child: VNode): void {
  child._parent = undefined;
}

// ── Factory Functions ───────────────────────────────────────────────

export function createVNode(type: string, props: Record<string, unknown>): VNode {
  return { type, props, children: [] };
}

export function createTextVNode(text: string): VNode {
  return { type: "#text", props: {}, children: [], text };
}

export function createVContainer(renderCallback: () => void): VContainer {
  return {
    children: [],
    scheduledRender: false,
    lastSvgHash: 0,
    renderCallback,
    renderTimer: null,
    _dupCount: 0,
    _dirty: true, // Start dirty to ensure first render runs
  };
}

// ── Serialization: VNode → React Element ────────────────────────────
// Converts a VNode tree back into React elements for use with
// Takumi's fromJsx() helper.  Only used by the devtools highlight
// path (the main render pipeline uses the direct vnodeToTakumiNode
// bypass in pipeline.ts instead).
//
// className → tw mapping: Takumi uses a `tw` prop for its built-in
// Tailwind CSS parser.  React components use `className` by convention.
// This bridge maps one to the other during serialization.

export function vnodeToElement(node: VNode): ReactElement | string {
  if (node.type === "#text") {
    return node.text ?? "";
  }

  const { children: _children, className, ...restProps } = node.props;

  // Map className → tw for Takumi's built-in Tailwind parser
  if (typeof className === "string" && className.length > 0) {
    const existingTw = typeof restProps.tw === "string" ? restProps.tw + " " : "";
    restProps.tw = existingTw + className;
  }

  const childElements = node.children.map(vnodeToElement);

  return createElement(node.type, restProps, ...childElements);
}
