import type { SerializedVNode } from "../types";

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
