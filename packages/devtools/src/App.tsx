import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { useDevtoolsSocket } from "./hooks/useDevtoolsSocket";
import { useStore } from "./hooks/useStore";
import { ConnectionStatus } from "./components/ConnectionStatus";
import { PluginSelector } from "./components/PluginSelector";
import { ResizablePanels, type LayoutDirection } from "./components/ResizablePanels";
import { ConsolePanel } from "./panels/ConsolePanel";
import { NetworkPanel } from "./panels/NetworkPanel";
import { ElementsPanel } from "./panels/ElementsPanel";
import { PreviewPanel } from "./panels/PreviewPanel";
import { EventsPanel } from "./panels/EventsPanel";

// ── Tab Definitions ─────────────────────────────────────────────────

const TABS = [
  { id: "console", label: "Console", shortcut: "1" },
  { id: "network", label: "Network", shortcut: "2" },
  { id: "elements", label: "Elements", shortcut: "3" },
  { id: "preview", label: "Preview", shortcut: "4" },
  { id: "events", label: "Events", shortcut: "5" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const PANEL_COMPONENTS: Record<TabId, () => ReactNode> = {
  console: () => <ConsolePanel />,
  network: () => <NetworkPanel />,
  elements: () => <ElementsPanel />,
  preview: () => <PreviewPanel />,
  events: () => <EventsPanel />,
};

// ── Context menu item class ─────────────────────────────────────────

const CTX_ITEM =
  "text-xs text-neutral-200 rounded px-2 py-1.5 cursor-pointer outline-none data-[highlighted]:bg-neutral-700 data-[disabled]:text-neutral-600 data-[disabled]:cursor-default flex items-center gap-2";

// ── App ─────────────────────────────────────────────────────────────

export function App() {
  const [activeTabs, setActiveTabs] = useState<Set<TabId>>(() => new Set(["preview"]));
  const [layoutDirection, setLayoutDirection] = useState<LayoutDirection>("horizontal");
  const [tabOrder, setTabOrder] = useState<TabId[]>(() => TABS.map((t) => t.id));
  const draggedTab = useRef<TabId | null>(null);
  const plugins = useStore((s) => s.plugins);
  const selectedPort = useStore((s) => s.selectedPort);
  const scanning = useStore((s) => s.scanning);
  const storeSelectPlugin = useStore((s) => s.selectPlugin);

  // Start port scanning (once on mount + manual via scan())
  const { requestSnapshot, scan } = useDevtoolsSocket();

  const handleSelectPlugin = (port: number) => {
    storeSelectPlugin(port);
    requestSnapshot(port);
  };

  const toggleTab = useCallback((id: TabId) => {
    setActiveTabs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        // Don't remove the last panel
        if (next.size > 1) next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const activateTab = useCallback((id: TabId) => {
    setActiveTabs((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  // Keyboard shortcuts: Ctrl+1-5 toggles panels, Ctrl+K clears
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        const tab = TABS.find((t) => t.shortcut === e.key);
        if (tab) {
          e.preventDefault();
          toggleTab(tab.id);
        }
        if (e.key === "k") {
          e.preventDefault();
          const store = useStore.getState();
          if (activeTabs.has("console")) store.clearConsole();
          if (activeTabs.has("network")) store.clearNetwork();
          if (activeTabs.has("events")) store.clearEvents();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeTabs, toggleTab]);

  const isHorizontal = layoutDirection === "horizontal";

  // Build ordered list of active panels (respects user-defined tab order)
  const activePanels = tabOrder
    .filter((id) => activeTabs.has(id))
    .map((id) => ({
      id,
      content: PANEL_COMPONENTS[id](),
    }));

  const handleLayoutSelect = useCallback(
    (tabId: TabId, dir: LayoutDirection) => {
      activateTab(tabId);
      setLayoutDirection(dir);
    },
    [activateTab],
  );

  // ── Drag-and-drop reordering ────────────────────────────────────
  const handleDragStart = useCallback((tabId: TabId) => {
    draggedTab.current = tabId;
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, targetId: TabId) => {
    e.preventDefault();
    const src = draggedTab.current;
    if (!src || src === targetId) return;
    setTabOrder((prev) => {
      const next = [...prev];
      const srcIdx = next.indexOf(src);
      const tgtIdx = next.indexOf(targetId);
      if (srcIdx === -1 || tgtIdx === -1) return prev;
      next.splice(srcIdx, 1);
      next.splice(tgtIdx, 0, src);
      return next;
    });
  }, []);

  const handleDragEnd = useCallback(() => {
    draggedTab.current = null;
  }, []);

  // Map tab ids to their definitions for ordered rendering
  const tabsById = Object.fromEntries(TABS.map((t) => [t.id, t])) as Record<
    TabId,
    (typeof TABS)[number]
  >;

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
            onSelect={handleSelectPlugin}
          />
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

      {/* Tab bar — left-click to toggle, right-click for layout direction, drag to reorder */}
      <div className="flex border-b border-neutral-800 bg-neutral-900 shrink-0">
        {tabOrder.map((tabId) => {
          const tab = tabsById[tabId];
          const isActive = activeTabs.has(tab.id);
          return (
            <ContextMenu.Root key={tab.id}>
              <ContextMenu.Trigger asChild>
                <button
                  draggable
                  onDragStart={() => handleDragStart(tab.id)}
                  onDragOver={(e) => handleDragOver(e, tab.id)}
                  onDragEnd={handleDragEnd}
                  onClick={() => toggleTab(tab.id)}
                  className={`px-4 py-2 text-xs transition-colors cursor-pointer ${
                    isActive
                      ? "text-blue-400 border-b-2 border-blue-400 bg-neutral-800/30"
                      : "text-neutral-500 hover:text-neutral-300 border-b-2 border-transparent"
                  }`}
                >
                  {tab.label}
                  <span className="ml-1 text-[10px] text-neutral-600">{tab.shortcut}</span>
                </button>
              </ContextMenu.Trigger>
              <ContextMenu.Portal>
                <ContextMenu.Content className="min-w-[160px] bg-neutral-800 border border-neutral-700 rounded-md p-1 shadow-lg shadow-black/40">
                  <ContextMenu.Item
                    disabled={isActive && isHorizontal}
                    onSelect={() => handleLayoutSelect(tab.id, "horizontal")}
                    className={CTX_ITEM}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 14 14"
                      fill="none"
                      className="shrink-0"
                    >
                      <rect
                        x="1"
                        y="2"
                        width="5"
                        height="10"
                        rx="1"
                        stroke="currentColor"
                        strokeWidth="1.2"
                      />
                      <rect
                        x="8"
                        y="2"
                        width="5"
                        height="10"
                        rx="1"
                        stroke="currentColor"
                        strokeWidth="1.2"
                      />
                    </svg>
                    Horizontal
                  </ContextMenu.Item>
                  <ContextMenu.Item
                    disabled={isActive && !isHorizontal}
                    onSelect={() => handleLayoutSelect(tab.id, "vertical")}
                    className={CTX_ITEM}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 14 14"
                      fill="none"
                      className="shrink-0"
                    >
                      <rect
                        x="2"
                        y="1"
                        width="10"
                        height="5"
                        rx="1"
                        stroke="currentColor"
                        strokeWidth="1.2"
                      />
                      <rect
                        x="2"
                        y="8"
                        width="10"
                        height="5"
                        rx="1"
                        stroke="currentColor"
                        strokeWidth="1.2"
                      />
                    </svg>
                    Vertical
                  </ContextMenu.Item>
                </ContextMenu.Content>
              </ContextMenu.Portal>
            </ContextMenu.Root>
          );
        })}
      </div>

      {/* Panels */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {plugins.length === 0 ? (
          <div className="flex items-center justify-center h-full text-neutral-500 text-sm">
            {scanning ? "Scanning for plugins..." : "No plugins found"}
          </div>
        ) : (
          <ResizablePanels panels={activePanels} direction={layoutDirection} />
        )}
      </div>
    </div>
  );
}
