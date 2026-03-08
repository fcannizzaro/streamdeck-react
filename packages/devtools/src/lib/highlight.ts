import type { SerializedVNode } from "../types";

// ── Find a node's path in the tree ──────────────────────────────────

export function findNodePath(
  tree: SerializedVNode,
  targetNid: number,
): number[] | null {
  if (tree.nid === targetNid) return [tree.nid];
  for (const child of tree.children) {
    const path = findNodePath(child, targetNid);
    if (path) return [tree.nid, ...path];
  }
  return null;
}

// ── Build a display label for a VNode ───────────────────────────────

export function nodeLabel(node: SerializedVNode): string {
  if (node.type === "#text") {
    const text = node.text ?? "";
    return text.length > 30 ? `"${text.slice(0, 27)}..."` : `"${text}"`;
  }
  if (node.type === "container") return "root";

  const className = node.props.className;
  const cls =
    className && className.t === "s" && className.v
      ? `.${className.v.split(" ").slice(0, 2).join(".")}`
      : "";
  return `<${node.type}${cls}>`;
}
