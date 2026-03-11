import type { ActionEntry, TouchBarEntry } from "../types";
import { useStore } from "../hooks/useStore";

// ── Image Preview Card ──────────────────────────────────────────────

export function ImagePreview({ action }: { action: ActionEntry }) {
  const highlightUri = useStore((s) => s.highlightDataUri.get(action.actionId) ?? null);

  const surfaceColors: Record<string, string> = {
    key: "bg-blue-900/40 text-blue-300",
    dial: "bg-green-900/40 text-green-300",
    touch: "bg-orange-900/40 text-orange-300",
  };

  // Show the highlighted image when available, otherwise the normal image
  const displayUri = highlightUri ?? action.dataUri;

  return (
    <div className="bg-neutral-800 rounded-lg p-3 flex flex-col items-center gap-2 relative group">
      {/* Header */}
      <div className="w-full flex items-center justify-between text-[10px]">
        <span className={`px-1.5 py-0.5 rounded ${surfaceColors[action.surface] ?? ""}`}>
          {action.surface}
        </span>
        <span className="text-neutral-500 truncate ml-2">{action.actionUuid.split(".").pop()}</span>
      </div>

      {/* Image */}
      <div
        className="relative"
        style={{ width: action.canvas.width, height: action.canvas.height }}
      >
        {displayUri ? (
          <img
            src={displayUri}
            width={action.canvas.width}
            height={action.canvas.height}
            className="rounded block"
            style={{ imageRendering: "pixelated" }}
          />
        ) : (
          <div
            className="bg-neutral-900 rounded flex items-center justify-center text-neutral-700 text-xs"
            style={{ width: action.canvas.width, height: action.canvas.height }}
          >
            No render
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="w-full text-[10px] text-neutral-500 flex items-center justify-between">
        <span>
          {action.canvas.width}x{action.canvas.height}
        </span>
        {action.coordinates && (
          <span>
            [{action.coordinates.row},{action.coordinates.column}]
          </span>
        )}
        <span className="truncate ml-1">{action.device.name}</span>
      </div>
    </div>
  );
}

// ── TouchBar Preview ────────────────────────────────────────────────

export function TouchBarPreview({ touchBar }: { touchBar: TouchBarEntry }) {
  const segments = [...touchBar.segments.entries()].sort(([a], [b]) => a - b);

  return (
    <div className="bg-neutral-800 rounded-lg p-3 flex flex-col gap-2">
      <div className="text-[10px] text-neutral-400 flex items-center gap-2">
        <span className="bg-purple-900/40 text-purple-300 px-1.5 py-0.5 rounded">touchbar</span>
        <span className="text-neutral-500">{touchBar.deviceName}</span>
        <span className="text-neutral-600 ml-auto">
          {touchBar.canvas.width}x{touchBar.canvas.height}
        </span>
      </div>
      <div className="flex">
        {segments.map(([col, seg]) => (
          <div key={col} className="relative">
            {seg.dataUri ? (
              <img
                src={seg.dataUri}
                width={200}
                height={100}
                className="block"
                style={{ imageRendering: "pixelated" }}
              />
            ) : (
              <div className="bg-neutral-900 rounded w-[200px] h-[100px] flex items-center justify-center text-neutral-700 text-xs">
                Col {col}
              </div>
            )}
            <span className="absolute bottom-0 left-0 text-[8px] text-neutral-500 px-1">
              col {col}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
