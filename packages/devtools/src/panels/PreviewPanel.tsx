import { useStore } from "../hooks/useStore";
import { ImagePreview, TouchBarPreview } from "../components/ImagePreview";

// ── Preview Panel ───────────────────────────────────────────────────

export function PreviewPanel() {
  const actions = useStore((s) => s.actions);
  const touchBars = useStore((s) => s.touchBars);

  const actionList = [...actions.values()];
  const touchBarList = [...touchBars.values()];

  if (actionList.length === 0 && touchBarList.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-neutral-600 text-xs">
        No active actions. Waiting for Stream Deck events...
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

      {touchBarList.length > 0 && (
        <div>
          <div className="text-xs text-neutral-500 mb-2 font-bold">
            Touch Bars
          </div>
          <div className="space-y-3">
            {touchBarList.map((tb) => (
              <TouchBarPreview key={tb.deviceId} touchBar={tb} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
