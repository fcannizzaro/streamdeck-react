import { useStore } from "../hooks/useStore";

export function ConnectionStatus() {
  const scanning = useStore((s) => s.scanning);
  const serverInfo = useStore((s) => s.serverInfo);
  const pluginCount = useStore((s) => s.plugins.length);
  const blocked = useStore((s) => s.blocked);

  return (
    <div className="flex items-center gap-2 text-xs">
      <div
        className={`w-2 h-2 rounded-full ${pluginCount > 0 ? "bg-green-500" : scanning ? "bg-yellow-500 animate-pulse" : blocked ? "bg-orange-500" : "bg-red-500"}`}
      />
      <span className="text-neutral-400">
        {pluginCount > 0
          ? `${pluginCount} plugin${pluginCount !== 1 ? "s" : ""} connected`
          : scanning
            ? "Scanning..."
            : blocked
              ? "Connection may be blocked by an ad blocker — disable it for this site or use npx streamdeck-react-devtools"
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
