import type { VContainer, VNode } from "@/reconciler/vnode";
import type { SerializedVNode } from "../types";
import { serializeValue } from "./value";

// ── VNode Tree Serialization ────────────────────────────────────────
//
// Converts a VContainer into a JSON-safe SerializedVNode tree for
// the devtools wire protocol.
//
// Each node receives a monotonic `nid` (node ID) assigned by a global
// counter that resets to 0 at the start of each serialization.  The
// nid is used by the devtools UI for hover-highlight targeting —
// when the user hovers over a node in the tree view, the nid is sent
// back to the plugin via highlight:action message, and the bridge
// uses it to find the corresponding VNode for overlay rendering.
//
// Safety limits:
//   MAX_TREE_DEPTH (50) and MAX_TOTAL_NODES (1000) prevent runaway
//   serialization of pathological trees.  Nodes beyond the limit
//   are replaced with a "[depth limit]" placeholder.

const MAX_TREE_DEPTH = 50;
const MAX_TOTAL_NODES = 1000;

let nodeCounter = 0;

export function serializeVNode(container: VContainer): SerializedVNode {
  nodeCounter = 0;
  return {
    nid: nodeCounter++,
    type: "container",
    props: {},
    children: container.children.map((child) => serializeNode(child, 0)),
  };
}

function serializeNode(node: VNode, depth: number): SerializedVNode {
  const nid = nodeCounter++;

  // Depth limit
  if (depth >= MAX_TREE_DEPTH || nodeCounter >= MAX_TOTAL_NODES) {
    return {
      nid,
      type: "[depth limit]",
      props: {},
      children: [],
    };
  }

  // Text node
  if (node.type === "#text") {
    return {
      nid,
      type: "#text",
      props: {},
      children: [],
      text: node.text,
    };
  }

  // Serialize props (skip 'children', limit depth to 4)
  const props: Record<string, import("../types").SerializedValue> = {};
  for (const [key, value] of Object.entries(node.props)) {
    if (key === "children") continue;
    props[key] = serializeValue(value, 4);
  }

  return {
    nid,
    type: node.type,
    props,
    children: node.children.map((child) => serializeNode(child, depth + 1)),
  };
}
