import type { DiscoveredPlugin } from "../types";

interface Props {
  plugins: DiscoveredPlugin[];
  selectedPort: number | null;
  onSelect: (port: number) => void;
}

export function PluginSelector({ plugins, selectedPort, onSelect }: Props) {
  if (plugins.length === 0) {
    return (
      <span className="text-xs text-neutral-500">No plugins discovered</span>
    );
  }

  return (
    <select
      value={selectedPort ?? ""}
      onChange={(e) => onSelect(Number(e.target.value))}
      className="bg-neutral-800 text-neutral-200 text-xs px-2 py-1 rounded border border-neutral-700 focus:border-neutral-500 focus:outline-none"
    >
      {plugins.map((p) => (
        <option key={p.port} value={p.port}>
          {p.devtoolsName} :{p.port}
        </option>
      ))}
    </select>
  );
}
