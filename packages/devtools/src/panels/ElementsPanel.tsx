import { useStore, findNodeByNid } from "../hooks/useStore";
import { VNodeTree } from "../components/VNodeTree";
import { PropsInspector } from "../components/PropsInspector";

// ── Elements Panel ──────────────────────────────────────────────────

export function ElementsPanel() {
  const actions = useStore((s) => s.actions);
  const selectedActionId = useStore((s) => s.selectedActionId);
  const setSelectedAction = useStore((s) => s.setSelectedAction);
  const selectedNodeId = useStore((s) => s.selectedNodeId);

  const actionList = [...actions.entries()];
  const selectedAction = selectedActionId ? actions.get(selectedActionId) : null;
  const selectedNode =
    selectedAction?.tree && selectedNodeId !== null
      ? findNodeByNid(selectedAction.tree, selectedNodeId)
      : null;

  return (
    <div className="flex flex-col h-full">
      {/* Action selector */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-neutral-800 bg-neutral-900/80 shrink-0">
        <span className="text-xs text-neutral-500">Action:</span>
        <select
          value={selectedActionId ?? ""}
          onChange={(e) => setSelectedAction(e.target.value || null)}
          className="bg-neutral-800 text-neutral-200 text-xs px-2 py-1 rounded border border-neutral-700 focus:border-neutral-500 focus:outline-none"
        >
          {actionList.length === 0 && <option value="">No actions</option>}
          {actionList.map(([id, action]) => (
            <option key={id} value={id}>
              {action.actionUuid.split(".").pop()} [{action.surface}]
              {action.coordinates
                ? ` (${action.coordinates.row},${action.coordinates.column})`
                : ""}
            </option>
          ))}
        </select>
        {selectedAction && (
          <span className="text-[10px] text-neutral-600 ml-auto">
            {selectedAction.canvas.width}x{selectedAction.canvas.height} -{" "}
            {selectedAction.device.name}
          </span>
        )}
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Tree pane */}
        <div className="w-1/2 border-r border-neutral-800 overflow-auto">
          {selectedAction?.tree ? (
            <VNodeTree node={selectedAction.tree} />
          ) : (
            <div className="flex items-center justify-center h-full text-neutral-600 text-xs">
              {selectedAction ? "No render tree" : "Select an action"}
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
