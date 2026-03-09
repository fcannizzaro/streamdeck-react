interface ToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  onClear?: () => void;
  children?: React.ReactNode;
}

export function Toolbar({ search, onSearchChange, onClear, children }: ToolbarProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-neutral-800 bg-neutral-900/80 shrink-0">
      <input
        type="text"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Filter..."
        className="bg-neutral-800 text-neutral-200 text-xs px-2 py-1 rounded border border-neutral-700 focus:border-neutral-500 focus:outline-none w-48"
      />
      {children}
      {onClear && (
        <button
          onClick={onClear}
          className="ml-auto text-xs text-neutral-500 hover:text-neutral-300 cursor-pointer"
        >
          Clear
        </button>
      )}
    </div>
  );
}

// ── Level / Type Toggle Button ──────────────────────────────────────

export function ToggleButton({
  label,
  active,
  color,
  onClick,
}: {
  label: string;
  active: boolean;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-xs px-1.5 py-0.5 rounded cursor-pointer transition-colors ${
        active ? `${color} bg-neutral-700` : "text-neutral-600 bg-neutral-800/50"
      }`}
    >
      {label}
    </button>
  );
}
