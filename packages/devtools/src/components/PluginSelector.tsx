import type { DiscoveredPlugin } from "../types";

interface Props {
  plugins: DiscoveredPlugin[];
  selectedPort: number | null;
  disconnectedPlugin: DiscoveredPlugin | null;
  onSelect: (port: number) => void;
}

export function PluginSelector({ plugins, selectedPort, disconnectedPlugin, onSelect }: Props) {
  if (plugins.length === 0 && !disconnectedPlugin) {
    return <span className="text-xs text-neutral-500">No plugins discovered</span>;
  }

  // Include the disconnected plugin in the options if it's not already in the list
  const showDisconnected =
    disconnectedPlugin && !plugins.some((p) => p.port === disconnectedPlugin.port);

  return (
    <select
      value={selectedPort ?? ""}
      onChange={(e) => onSelect(Number(e.target.value))}
      className="bg-neutral-800 text-neutral-200 text-xs px-2 py-1 rounded border border-neutral-700 focus:border-neutral-500 focus:outline-none"
    >
      {showDisconnected && (
        <option key={disconnectedPlugin.port} value={disconnectedPlugin.port}>
          {disconnectedPlugin.devtoolsName} :{disconnectedPlugin.port} (disconnected)
        </option>
      )}
      {plugins.map((p) => (
        <option key={p.port} value={p.port}>
          {p.devtoolsName} :{p.port}
        </option>
      ))}
    </select>
  );
}
