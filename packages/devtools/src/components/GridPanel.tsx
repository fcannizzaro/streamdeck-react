import { forwardRef, type ReactNode } from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { useLayoutStore, type TabId } from "../hooks/useLayoutStore";
import { ConsolePanel } from "../panels/ConsolePanel";
import { NetworkPanel } from "../panels/NetworkPanel";
import { ElementsPanel } from "../panels/ElementsPanel";
import { PreviewPanel } from "../panels/PreviewPanel";
import { EventsPanel } from "../panels/EventsPanel";

// ── Panel registry ──────────────────────────────────────────────────

const PANEL_COMPONENTS: Record<TabId, () => ReactNode> = {
  console: () => <ConsolePanel />,
  network: () => <NetworkPanel />,
  elements: () => <ElementsPanel />,
  preview: () => <PreviewPanel />,
  events: () => <EventsPanel />,
};

const PANEL_LABELS: Record<TabId, string> = {
  console: "Console",
  network: "Network",
  elements: "Elements",
  preview: "Preview",
  events: "Events",
};

// ── Panel Icons (14x14 SVGs) ────────────────────────────────────────

const PANEL_ICONS: Record<TabId, ReactNode> = {
  console: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="2" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4 6l2 1.5L4 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7.5 9H10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  ),
  network: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2" />
      <ellipse cx="7" cy="7" rx="2.5" ry="5.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M1.5 7h11" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  ),
  elements: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M5.5 3L2 7l3.5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.5 3L12 7l-3.5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  preview: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M1 7s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4z" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="7" cy="7" r="2" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  ),
  events: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M7.5 1.5L4 8h3l-.5 4.5L10 6H7l.5-4.5z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

// ── Styles ──────────────────────────────────────────────────────────

const CTX_ITEM =
  "text-xs text-neutral-200 rounded px-2 py-1.5 cursor-pointer outline-none data-[highlighted]:bg-neutral-700 data-[disabled]:text-neutral-600 data-[disabled]:cursor-default flex items-center gap-2";

// ── GridPanel ───────────────────────────────────────────────────────
// Wraps each panel in the grid. Must forwardRef for react-grid-layout.

interface GridPanelProps {
  panelId: TabId;
  style?: React.CSSProperties;
  className?: string;
  onMouseDown?: React.MouseEventHandler;
  onMouseUp?: React.MouseEventHandler;
  onTouchEnd?: React.TouchEventHandler;
  children?: ReactNode; // RGL injects resize handle here
}

export const GridPanel = forwardRef<HTMLDivElement, GridPanelProps>(
  ({ panelId, style, className, onMouseDown, onMouseUp, onTouchEnd, children, ...rest }, ref) => {
    const layout = useLayoutStore((s) => s.layout);
    const removePanel = useLayoutStore((s) => s.removePanel);

    const label = PANEL_LABELS[panelId];
    const icon = PANEL_ICONS[panelId];
    const PanelContent = PANEL_COMPONENTS[panelId];
    const isLastPanel = layout.length <= 1;

    return (
      <div
        ref={ref}
        style={style}
        className={`${className ?? ""} flex flex-col bg-neutral-900 border border-neutral-800 rounded overflow-hidden`}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onTouchEnd={onTouchEnd}
        {...rest}
      >
        {/* Header — drag handle */}
        <ContextMenu.Root>
          <ContextMenu.Trigger asChild>
            <div className="panel-drag-handle flex items-center gap-1.5 px-2 py-1 bg-neutral-950 border-b border-neutral-800 shrink-0 select-none cursor-grab active:cursor-grabbing">
              <span className="text-neutral-500">{icon}</span>
              <span className="text-[11px] font-medium text-neutral-400">{label}</span>
              {!isLastPanel && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removePanel(panelId);
                  }}
                  className="ml-auto text-neutral-600 hover:text-neutral-300 transition-colors cursor-pointer text-xs leading-none px-1"
                  title="Close panel"
                >
                  ✕
                </button>
              )}
            </div>
          </ContextMenu.Trigger>

          <ContextMenu.Portal>
            <ContextMenu.Content className="min-w-[140px] bg-neutral-800 border border-neutral-700 rounded-md p-1 shadow-lg shadow-black/40">
              <ContextMenu.Item
                className={CTX_ITEM}
                disabled={isLastPanel}
                onSelect={() => removePanel(panelId)}
              >
                Close
              </ContextMenu.Item>
            </ContextMenu.Content>
          </ContextMenu.Portal>
        </ContextMenu.Root>

        {/* Panel content */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <PanelContent />
        </div>

        {/* RGL injects resize handles via children */}
        {children}
      </div>
    );
  },
);

GridPanel.displayName = "GridPanel";
