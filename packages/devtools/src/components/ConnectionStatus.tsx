import { useStore } from "../hooks/useStore";

export function ConnectionStatus() {
  const scanning = useStore((s) => s.scanning);
  const serverInfo = useStore((s) => s.serverInfo);
  const pluginCount = useStore((s) => s.plugins.length);

  return (
    <div className="flex items-center gap-2 text-xs">
      <div
        className={`w-2 h-2 rounded-full ${pluginCount > 0 ? "bg-green-500" : scanning ? "bg-yellow-500 animate-pulse" : "bg-red-500"}`}
      />
      <span className="text-neutral-400">
        {pluginCount > 0
          ? `${pluginCount} plugin${pluginCount !== 1 ? "s" : ""} connected`
          : scanning
            ? "Scanning..."
            : "No plugins found"}
      </span>
      {serverInfo && (
        <span className="text-neutral-600">
          {serverInfo.library} v{serverInfo.version}
        </span>
      )}
    </div>
  );
}
