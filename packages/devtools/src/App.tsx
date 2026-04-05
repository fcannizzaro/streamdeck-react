import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import ReactGridLayout, { useContainerWidth, verticalCompactor } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import { useDevtoolsSocket } from "./hooks/useDevtoolsSocket";
import { useStore } from "./hooks/useStore";
import { useLayoutStore, getActivePanelIds, type TabId } from "./hooks/useLayoutStore";
import { ConnectionStatus } from "./components/ConnectionStatus";
import { PluginSelector } from "./components/PluginSelector";
import { ActionSelector } from "./components/ActionSelector";
import { GridPanel } from "./components/GridPanel";
import type { Layout } from "react-grid-layout";

// ── Tab Definitions ─────────────────────────────────────────────────

const TABS: readonly { id: TabId; label: string; shortcut: string }[] = [
  { id: "console", label: "Console", shortcut: "1" },
  { id: "network", label: "Network", shortcut: "2" },
  { id: "elements", label: "Elements", shortcut: "3" },
  { id: "preview", label: "Preview", shortcut: "4" },
  { id: "events", label: "Events", shortcut: "5" },
  { id: "performance", label: "Performance", shortcut: "6" },
];

// ── Grid constants ──────────────────────────────────────────────────

const GRID_COLS = 12;
const GRID_ROWS = 12;
const GRID_GAP: [number, number] = [4, 4];

// ── App ─────────────────────────────────────────────────────────────

export function App() {
  const plugins = useStore((s) => s.plugins);
  const selectedPort = useStore((s) => s.selectedPort);
  const scanning = useStore((s) => s.scanning);
  const waitingForReconnect = useStore((s) => s.waitingForReconnect);
  const disconnectedPlugin = useStore((s) => s.disconnectedPlugin);
  const storeSelectPlugin = useStore((s) => s.selectPlugin);

  const layout = useLayoutStore((s) => s.layout);
  const addPanel = useLayoutStore((s) => s.addPanel);
  const togglePanel = useLayoutStore((s) => s.togglePanel);
  const updateLayout = useLayoutStore((s) => s.updateLayout);

  // RGL width measurement
  const { width, containerRef, mounted } = useContainerWidth();

  // Track container height for dynamic rowHeight
  const [containerHeight, setContainerHeight] = useState(600);
  const heightObserverRef = useRef<ResizeObserver | null>(null);

  // Observe container height changes
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });
    observer.observe(el);
    heightObserverRef.current = observer;

    return () => {
      observer.disconnect();
      heightObserverRef.current = null;
    };
  }, [containerRef]);

  // Dynamic row height: fill available vertical space
  const rowHeight = Math.max(1, (containerHeight - (GRID_ROWS - 1) * GRID_GAP[1]) / GRID_ROWS);

  // Derive active/inactive panels from layout
  const activePanelIds = useMemo(() => getActivePanelIds(layout), [layout]);
  const inactiveTabs = useMemo(
    () => TABS.filter((tab) => !activePanelIds.has(tab.id)),
    [activePanelIds],
  );

  // Start port scanning (once on mount + manual via scan())
  const { requestSnapshot, scan } = useDevtoolsSocket();

  const handleSelectPlugin = (port: number) => {
    storeSelectPlugin(port);
    requestSnapshot(port);
  };

  // Keyboard shortcuts: Ctrl+1-5 toggles panels, Ctrl+K clears
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        const tab = TABS.find((t) => t.shortcut === e.key);
        if (tab) {
          e.preventDefault();
          togglePanel(tab.id);
        }
        if (e.key === "k") {
          e.preventDefault();
          const store = useStore.getState();
          if (activePanelIds.has("console")) store.clearConsole();
          if (activePanelIds.has("network")) store.clearNetwork();
          if (activePanelIds.has("events")) store.clearEvents();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activePanelIds, togglePanel]);

  const handleLayoutChange = useCallback(
    (newLayout: Layout) => {
      updateLayout([...newLayout]);
    },
    [updateLayout],
  );

  return (
    <div className="flex flex-col h-screen bg-neutral-900 text-neutral-100">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-neutral-800 bg-neutral-950 shrink-0">
        <div className="flex items-center gap-4">
          <span className="text-sm font-bold text-neutral-300">SD React DevTools</span>
          <ConnectionStatus />
        </div>

        <div className="flex items-center gap-3">
          <PluginSelector
            plugins={plugins}
            selectedPort={selectedPort}
            disconnectedPlugin={disconnectedPlugin}
            onSelect={handleSelectPlugin}
          />
          <ActionSelector />
          <button
            onClick={scan}
            disabled={scanning}
            title="Scan for plugins"
            className="text-neutral-400 hover:text-neutral-200 disabled:text-neutral-600 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              className={scanning ? "animate-spin" : ""}
            >
              <path
                d="M13.65 2.35A7 7 0 1 0 15 8h-2a5 5 0 1 1-1-3.5L10 6.5h5V1.5l-1.35.85Z"
                fill="currentColor"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Tab bar — only show inactive panels; hide when all are active */}
      {inactiveTabs.length > 0 && (
        <div className="flex border-b border-neutral-800 bg-neutral-900 shrink-0">
          {inactiveTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => addPanel(tab.id)}
              className="px-4 py-2 text-xs text-neutral-500 hover:text-neutral-300 border-b-2 border-transparent transition-colors cursor-pointer"
            >
              {tab.label}
              <span className="ml-1 text-[10px] text-neutral-600">{tab.shortcut}</span>
            </button>
          ))}
        </div>
      )}

      {/* Grid panels */}
      <div ref={containerRef} className="flex-1 min-h-0 overflow-auto">
        {waitingForReconnect ? (
          <div className="flex flex-col items-center justify-center h-full text-neutral-500 gap-3">
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-neutral-600"
            >
              <path d="M12 2v4" />
              <path d="M12 18v4" />
              <path d="M4.93 4.93l2.83 2.83" />
              <path d="M16.24 16.24l2.83 2.83" />
              <path d="M2 12h4" />
              <path d="M18 12h4" />
              <path d="M4.93 19.07l2.83-2.83" />
              <path d="M16.24 7.76l2.83-2.83" />
            </svg>
            <span className="text-sm">
              Waiting for{" "}
              <span className="text-neutral-400">
                {disconnectedPlugin?.devtoolsName ?? "plugin"}
              </span>{" "}
              to reconnect&hellip;
            </span>
          </div>
        ) : plugins.length === 0 ? (
          <div className="flex items-center justify-center h-full text-neutral-500 text-sm">
            {scanning ? "Scanning for plugins..." : "No plugins found"}
          </div>
        ) : mounted && layout.length > 0 ? (
          <ReactGridLayout
            width={width}
            layout={layout}
            gridConfig={{
              cols: GRID_COLS,
              rowHeight,
              margin: GRID_GAP,
              containerPadding: [0, 0],
            }}
            dragConfig={{
              enabled: true,
              handle: ".panel-drag-handle",
            }}
            resizeConfig={{
              enabled: true,
              handles: ["se", "sw", "e", "s", "w"],
            }}
            compactor={verticalCompactor}
            autoSize
            onLayoutChange={handleLayoutChange}
          >
            {layout.map((item) => (
              <GridPanel key={item.i} panelId={item.i as TabId} />
            ))}
          </ReactGridLayout>
        ) : layout.length === 0 ? (
          <div className="flex items-center justify-center h-full text-neutral-500 text-sm">
            Click a tab to open a panel
          </div>
        ) : null}
      </div>
    </div>
  );
}
