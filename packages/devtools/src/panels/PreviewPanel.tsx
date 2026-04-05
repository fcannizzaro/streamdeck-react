import { useStore } from "../hooks/useStore";
import { ImagePreview, TouchStripPreview } from "../components/ImagePreview";

// ── Preview Panel ───────────────────────────────────────────────────
//
// Renders visual previews of action keys and TouchStrip surfaces.
// When a specific action is selected in the global ActionSelector
// (`selectedActionId !== null`), only that action's preview is shown.
// When "All" is selected (`selectedActionId === null`), all actions
// are displayed grouped by device.

const TB_PREFIX = "touchStrip:";

export function PreviewPanel() {
  const actions = useStore((s) => s.actions);
  const touchStrips = useStore((s) => s.touchStrips);
  const selectedActionId = useStore((s) => s.selectedActionId);

  // ── Apply global action filter ──────────────────────────────────
  // When a specific action is selected, narrow the lists to that
  // single item.  TouchStrip selections use the "touchStrip:" prefix.
  let actionList = [...actions.values()];
  let touchStripList = [...touchStrips.values()];

  if (selectedActionId) {
    if (selectedActionId.startsWith(TB_PREFIX)) {
      const deviceId = selectedActionId.slice(TB_PREFIX.length);
      actionList = [];
      touchStripList = touchStripList.filter((tb) => tb.deviceId === deviceId);
    } else {
      actionList = actionList.filter((a) => a.actionId === selectedActionId);
      touchStripList = [];
    }
  }

  if (actionList.length === 0 && touchStripList.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-neutral-600 text-xs">
        {selectedActionId
          ? "No preview for selected action"
          : "No active actions. Waiting for Stream Deck events..."}
      </div>
    );
  }

  // Group actions by device
  const byDevice = new Map<string, typeof actionList>();
  for (const action of actionList) {
    const key = action.device.id || "unknown";
    if (!byDevice.has(key)) byDevice.set(key, []);
    byDevice.get(key)!.push(action);
  }

  return (
    <div className="p-4 overflow-auto h-full space-y-6">
      {[...byDevice.entries()].map(([deviceId, deviceActions]) => (
        <div key={deviceId}>
          <div className="text-xs text-neutral-500 mb-2 flex items-center gap-2">
            <span className="text-neutral-400 font-bold">
              {deviceActions[0]?.device.name ?? "Unknown Device"}
            </span>
            <span className="text-neutral-600">{deviceId}</span>
          </div>
          <div className="flex flex-wrap gap-3">
            {deviceActions
              .sort((a, b) => {
                const ar = a.coordinates?.row ?? 0;
                const br = b.coordinates?.row ?? 0;
                if (ar !== br) return ar - br;
                return (a.coordinates?.column ?? 0) - (b.coordinates?.column ?? 0);
              })
              .map((action) => (
                <ImagePreview key={action.actionId} action={action} />
              ))}
          </div>
        </div>
      ))}

      {touchStripList.length > 0 && (
        <div>
          <div className="text-xs text-neutral-500 mb-2 font-bold">Touch Bars</div>
          <div className="space-y-3">
            {touchStripList.map((tb) => (
              <TouchStripPreview key={tb.deviceId} touchStrip={tb} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
