import type { SerializedVNode } from "../types";
import { ValueRenderer } from "./ValueRenderer";

// ── Props Inspector ─────────────────────────────────────────────────

export function PropsInspector({ node }: { node: SerializedVNode | null }) {
  if (!node) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-neutral-600">
        Select a node to inspect props
      </div>
    );
  }

  const entries = Object.entries(node.props);

  return (
    <div className="p-3 text-xs overflow-auto h-full">
      <div className="mb-3">
        <span className="text-neutral-500">Type: </span>
        <span className="text-pink-400">{node.type}</span>
        <span className="text-neutral-500 ml-4">nid: </span>
        <span className="text-blue-400">{node.nid}</span>
        <span className="text-neutral-500 ml-4">Children: </span>
        <span className="text-blue-400">{node.children.length}</span>
      </div>

      {node.text !== undefined && (
        <div className="mb-3">
          <span className="text-neutral-500">Text: </span>
          <span className="text-green-400">"{node.text}"</span>
        </div>
      )}

      {entries.length === 0 ? (
        <div className="text-neutral-600">No props</div>
      ) : (
        <div className="space-y-1.5">
          {entries.map(([key, val]) => (
            <div key={key} className="flex gap-2">
              <span className="text-purple-300 shrink-0">{key}:</span>
              <ValueRenderer value={val} depth={0} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
