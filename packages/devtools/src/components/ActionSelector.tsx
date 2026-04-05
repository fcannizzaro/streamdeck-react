import { useStore } from "../hooks/useStore";

// ── Action Selector ─────────────────────────────────────────────────
//
// Global action / TouchStrip picker displayed in the top bar.
// Sets `selectedActionId` in the store, which is consumed by panels
// (Elements, Preview, Events, Performance) to filter their content
// to a single action.
//
// When "All" is selected (`selectedActionId === null`), panels show
// unfiltered data.  When a specific action is chosen, panels narrow
// their view to that action only.
//
// The dropdown merges entries from the `actions` map (keyed by
// actionId) and the `touchStrips` map (keyed by deviceId, prefixed
// with "touchStrip:" to avoid collisions).

const TB_PREFIX = "touchStrip:";

export function ActionSelector() {
  const actions = useStore((s) => s.actions);
  const touchStrips = useStore((s) => s.touchStrips);
  const selectedActionId = useStore((s) => s.selectedActionId);
  const setSelectedAction = useStore((s) => s.setSelectedAction);

  const hasItems = actions.size > 0 || touchStrips.size > 0;

  // Resolve dimension and context labels for the selected item
  let dimensionLabel = "";
  let contextLabel = "";

  if (selectedActionId) {
    if (selectedActionId.startsWith(TB_PREFIX)) {
      const deviceId = selectedActionId.slice(TB_PREFIX.length);
      const tb = touchStrips.get(deviceId);
      if (tb) {
        dimensionLabel = `${tb.canvas.width}x${tb.canvas.height}`;
        contextLabel = tb.deviceName;
      }
    } else {
      const action = actions.get(selectedActionId);
      if (action) {
        dimensionLabel = `${action.canvas.width}x${action.canvas.height}`;
        contextLabel = action.device.name;
      }
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-neutral-500">Action:</span>
      <select
        value={selectedActionId ?? ""}
        onChange={(e) => setSelectedAction(e.target.value || null)}
        className="bg-neutral-800 text-neutral-200 text-xs px-2 py-1 rounded border border-neutral-700 focus:border-neutral-500 focus:outline-none"
      >
        {!hasItems && <option value="">No actions</option>}

        {/* "All" option — clears the per-action filter */}
        {hasItems && <option value="">All</option>}

        {/* Key / Dial / Touch actions */}
        {[...actions.entries()].map(([id, action]) => (
          <option key={id} value={id}>
            {action.actionUuid.split(".").pop()} [{action.surface}]
            {action.coordinates ? ` (${action.coordinates.row},${action.coordinates.column})` : ""}
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
        <span className="text-[10px] text-neutral-600">
          {dimensionLabel} - {contextLabel}
        </span>
      )}
    </div>
  );
}
