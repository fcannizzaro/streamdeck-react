import { useStore, findNodeByNid } from "../hooks/useStore";
import { VNodeTree } from "../components/VNodeTree";
import { PropsInspector } from "../components/PropsInspector";
import type { SerializedVNode } from "../types";

// ── Elements Panel ──────────────────────────────────────────────────
//
// Unified element inspector for both key/dial actions and TouchStrip
// surfaces.  The dropdown merges entries from the `actions` map
// (keyed by actionId) and the `touchStrips` map (keyed by deviceId,
// prefixed with "touchStrip:" to avoid collisions).
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
  const setSelectedAction = useStore((s) => s.setSelectedAction);
  const selectedNodeId = useStore((s) => s.selectedNodeId);

  // ── Resolve selected item's tree ────────────────────────────────
  // The selectedActionId can be either a plain actionId (key/dial)
  // or a "touchStrip:<deviceId>" string (TouchStrip surface).  We look
  // up the correct map based on the prefix.
  let selectedTree: SerializedVNode | null = null;
  let dimensionLabel = "";
  let contextLabel = "";

  if (selectedActionId) {
    if (selectedActionId.startsWith(TB_PREFIX)) {
      const deviceId = selectedActionId.slice(TB_PREFIX.length);
      const tb = touchStrips.get(deviceId);
      if (tb) {
        selectedTree = tb.tree;
        dimensionLabel = `${tb.canvas.width}x${tb.canvas.height}`;
        contextLabel = tb.deviceName;
      }
    } else {
      const action = actions.get(selectedActionId);
      if (action) {
        selectedTree = action.tree;
        dimensionLabel = `${action.canvas.width}x${action.canvas.height}`;
        contextLabel = action.device.name;
      }
    }
  }

  const selectedNode =
    selectedTree && selectedNodeId !== null ? findNodeByNid(selectedTree, selectedNodeId) : null;

  const hasItems = actions.size > 0 || touchStrips.size > 0;

  return (
    <div className="flex flex-col h-full">
      {/* Action / TouchStrip selector */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-neutral-800 bg-neutral-900/80 shrink-0">
        <span className="text-xs text-neutral-500">Action:</span>
        <select
          value={selectedActionId ?? ""}
          onChange={(e) => setSelectedAction(e.target.value || null)}
          className="bg-neutral-800 text-neutral-200 text-xs px-2 py-1 rounded border border-neutral-700 focus:border-neutral-500 focus:outline-none"
        >
          {!hasItems && <option value="">No actions</option>}

          {/* Key / Dial / Touch actions */}
          {[...actions.entries()].map(([id, action]) => (
            <option key={id} value={id}>
              {action.actionUuid.split(".").pop()} [{action.surface}]
              {action.coordinates
                ? ` (${action.coordinates.row},${action.coordinates.column})`
                : ""}
            </option>
          ))}

          {/* TouchStrip surfaces */}
          {[...touchStrips.entries()].map(([deviceId, tb]) => (
            <option key={`${TB_PREFIX}${deviceId}`} value={`${TB_PREFIX}${deviceId}`}>
              TouchStrip [{tb.deviceName}]
            </option>
          ))}
        </select>

        {selectedActionId && dimensionLabel && (
          <span className="text-[10px] text-neutral-600 ml-auto">
            {dimensionLabel} - {contextLabel}
          </span>
        )}
      </div>

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
