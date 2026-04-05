import { useStore, findNodeByNid } from "../hooks/useStore";
import { VNodeTree } from "../components/VNodeTree";
import { PropsInspector } from "../components/PropsInspector";
import type { SerializedVNode } from "../types";

// ── Elements Panel ──────────────────────────────────────────────────
//
// Unified element inspector for both key/dial actions and TouchStrip
// surfaces.  The selected action is driven by the global
// `selectedActionId` in the store (set by the ActionSelector in the
// top bar).
//
// The `touchStrip:<deviceId>` key convention matches the one used by
// profile entries in the Performance panel, keeping IDs consistent
// across panels.

// ── TouchStrip ID prefix ─────────────────────────────────────────────

const TB_PREFIX = "touchStrip:";

export function ElementsPanel() {
  const actions = useStore((s) => s.actions);
  const touchStrips = useStore((s) => s.touchStrips);
  const selectedActionId = useStore((s) => s.selectedActionId);
  const selectedNodeId = useStore((s) => s.selectedNodeId);

  // ── Resolve selected item's tree ────────────────────────────────
  // The selectedActionId can be either a plain actionId (key/dial)
  // or a "touchStrip:<deviceId>" string (TouchStrip surface).  We look
  // up the correct map based on the prefix.
  let selectedTree: SerializedVNode | null = null;

  if (selectedActionId) {
    if (selectedActionId.startsWith(TB_PREFIX)) {
      const deviceId = selectedActionId.slice(TB_PREFIX.length);
      const tb = touchStrips.get(deviceId);
      if (tb) {
        selectedTree = tb.tree;
      }
    } else {
      const action = actions.get(selectedActionId);
      if (action) {
        selectedTree = action.tree;
      }
    }
  }

  const selectedNode =
    selectedTree && selectedNodeId !== null ? findNodeByNid(selectedTree, selectedNodeId) : null;

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-1 min-h-0">
        {/* Tree pane */}
        <div className="w-1/2 border-r border-neutral-800 overflow-auto">
          {selectedTree ? (
            <VNodeTree node={selectedTree} />
          ) : (
            <div className="flex items-center justify-center h-full text-neutral-600 text-xs">
              {selectedActionId ? "No render tree" : "Select an action"}
            </div>
          )}
        </div>

        {/* Props pane */}
        <div className="w-1/2 overflow-auto">
          <PropsInspector node={selectedNode} />
        </div>
      </div>
    </div>
  );
}
