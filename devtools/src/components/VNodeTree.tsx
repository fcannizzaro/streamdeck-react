import { useState, useCallback } from "react";
import type { SerializedVNode } from "../types";
import { nodeLabel } from "../lib/highlight";
import { useStore } from "../hooks/useStore";

// ── VNode Tree ──────────────────────────────────────────────────────

export function VNodeTree({ node, depth = 0 }: { node: SerializedVNode; depth?: number }) {
  const [expanded, setExpanded] = useState(depth < 3);
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const setSelectedNode = useStore((s) => s.setSelectedNode);
  const setHoveredNode = useStore((s) => s.setHoveredNode);

  const hasChildren = node.children.length > 0;
  const isSelected = selectedNodeId === node.nid;
  const label = nodeLabel(node);

  const handleClick = useCallback(() => {
    setSelectedNode(node.nid);
    if (hasChildren) setExpanded((e) => !e);
  }, [node.nid, hasChildren, setSelectedNode]);

  const handleMouseEnter = useCallback(() => {
    setHoveredNode(node.nid);
  }, [node.nid, setHoveredNode]);

  const handleMouseLeave = useCallback(() => {
    setHoveredNode(null);
  }, [setHoveredNode]);

  if (node.type === "#text") {
    return (
      <div
        className={`pl-${Math.min(depth * 4, 16)} py-0.5 text-xs cursor-pointer hover:bg-neutral-800 ${
          isSelected ? "bg-neutral-800 text-white" : "text-green-400"
        }`}
        style={{ paddingLeft: depth * 16 }}
        onClick={() => setSelectedNode(node.nid)}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {label}
      </div>
    );
  }

  return (
    <div>
      <div
        className={`flex items-center py-0.5 text-xs cursor-pointer hover:bg-neutral-800 ${
          isSelected ? "bg-blue-900/40 text-blue-300" : "text-neutral-300"
        }`}
        style={{ paddingLeft: depth * 16 }}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {hasChildren && (
          <span className="w-3 text-neutral-600 text-[10px] shrink-0">
            {expanded ? "\u25BC" : "\u25B6"}
          </span>
        )}
        {!hasChildren && <span className="w-3 shrink-0" />}
        <span>
          <span className="text-pink-400">&lt;{node.type}</span>
          <NodeAttrs props={node.props} />
          <span className="text-pink-400">
            {hasChildren ? ">" : " />"}
          </span>
        </span>
      </div>
      {expanded && hasChildren && (
        <>
          {node.children.map((child) => (
            <VNodeTree key={child.nid} node={child} depth={depth + 1} />
          ))}
          <div
            className="text-xs text-pink-400 py-0.5"
            style={{ paddingLeft: depth * 16 + 12 }}
          >
            &lt;/{node.type}&gt;
          </div>
        </>
      )}
    </div>
  );
}

// ── Attribute previews ──────────────────────────────────────────────

function NodeAttrs({ props }: { props: Record<string, import("../types").SerializedValue> }) {
  const entries = Object.entries(props);
  if (entries.length === 0) return null;

  // Show at most 3 key attrs inline
  const shown = entries.slice(0, 3);
  const hasMore = entries.length > 3;

  return (
    <>
      {shown.map(([key, val]) => (
        <span key={key}>
          <span className="text-orange-300"> {key}</span>
          <span className="text-neutral-500">=</span>
          <AttrValue value={val} />
        </span>
      ))}
      {hasMore && <span className="text-neutral-600"> ...</span>}
    </>
  );
}

function AttrValue({ value }: { value: import("../types").SerializedValue }) {
  switch (value.t) {
    case "s":
      return <span className="text-green-400">"{value.v.length > 30 ? value.v.slice(0, 27) + "..." : value.v}"</span>;
    case "n":
      return <span className="text-blue-400">{`{${value.v}}`}</span>;
    case "b":
      return <span className="text-purple-400">{`{${value.v}}`}</span>;
    case "obj":
      return <span className="text-neutral-500">{"{...}"}</span>;
    case "arr":
      return <span className="text-neutral-500">[...]</span>;
    default:
      return <span className="text-neutral-500">{"{...}"}</span>;
  }
}
