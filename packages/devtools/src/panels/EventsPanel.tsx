import { useMemo, useRef, useEffect } from "react";
import { useStore } from "../hooks/useStore";
import { Toolbar, ToggleButton } from "../components/Toolbar";
import { ValueRenderer } from "../components/ValueRenderer";

// ── Events Panel ────────────────────────────────────────────────────

const EVENT_CATEGORIES: Record<string, { color: string; label: string }> = {
  keyDown: { color: "text-blue-300", label: "key" },
  keyUp: { color: "text-blue-300", label: "key" },
  dialRotate: { color: "text-green-300", label: "dial" },
  dialDown: { color: "text-green-300", label: "dial" },
  dialUp: { color: "text-green-300", label: "dial" },
  touchTap: { color: "text-orange-300", label: "touch" },
  touchStripTap: { color: "text-purple-300", label: "tb" },
  touchStripDialRotate: { color: "text-purple-300", label: "tb" },
  touchStripDialDown: { color: "text-purple-300", label: "tb" },
  touchStripDialUp: { color: "text-purple-300", label: "tb" },
  willAppear: { color: "text-neutral-400", label: "lifecycle" },
  willDisappear: { color: "text-neutral-400", label: "lifecycle" },
  settingsChanged: { color: "text-yellow-300", label: "settings" },
  sendToPlugin: { color: "text-cyan-300", label: "pi" },
  propertyInspectorDidAppear: { color: "text-cyan-300", label: "pi" },
  propertyInspectorDidDisappear: { color: "text-cyan-300", label: "pi" },
  titleParametersDidChange: { color: "text-neutral-400", label: "title" },
};

export function EventsPanel() {
  const events = useStore((s) => s.events);
  const eventFilter = useStore((s) => s.eventFilter);
  const setEventFilter = useStore((s) => s.setEventFilter);
  const clearEvents = useStore((s) => s.clearEvents);
  const selectedActionId = useStore((s) => s.selectedActionId);
  const listRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);

  // Unique event types for filter toggles
  const allEventTypes = useMemo(() => {
    const types = new Set<string>();
    for (const ev of events) types.add(ev.event);
    return [...types].sort();
  }, [events]);

  // Filtered events — combines global action filter with local
  // type/search filters.  When `selectedActionId` is set, only
  // events matching that actionId are shown.
  const filtered = useMemo(() => {
    return events.filter((ev) => {
      // Global action filter from the top-bar ActionSelector
      if (selectedActionId && ev.actionId !== selectedActionId) return false;
      if (eventFilter.types.size > 0 && !eventFilter.types.has(ev.event)) return false;
      if (eventFilter.search) {
        const searchLower = eventFilter.search.toLowerCase();
        if (
          !ev.event.toLowerCase().includes(searchLower) &&
          !ev.actionId.toLowerCase().includes(searchLower) &&
          !ev.actionUuid.toLowerCase().includes(searchLower)
        )
          return false;
      }
      return true;
    });
  }, [events, eventFilter, selectedActionId]);

  // Auto-scroll
  useEffect(() => {
    if (shouldAutoScroll.current && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [filtered.length]);

  const handleScroll = () => {
    if (!listRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = listRef.current;
    shouldAutoScroll.current = scrollHeight - scrollTop - clientHeight < 50;
  };

  const toggleType = (type: string) => {
    const newTypes = new Set(eventFilter.types);
    if (newTypes.has(type)) newTypes.delete(type);
    else newTypes.add(type);
    setEventFilter({ types: newTypes });
  };

  return (
    <div className="flex flex-col h-full">
      <Toolbar
        search={eventFilter.search}
        onSearchChange={(search) => setEventFilter({ search })}
        onClear={clearEvents}
      >
        <div className="flex gap-1 flex-wrap">
          {allEventTypes.map((type) => {
            const cat = EVENT_CATEGORIES[type];
            return (
              <ToggleButton
                key={type}
                label={type}
                active={eventFilter.types.size === 0 || eventFilter.types.has(type)}
                color={cat?.color ?? "text-neutral-300"}
                onClick={() => toggleType(type)}
              />
            );
          })}
        </div>
        <span className="text-[10px] text-neutral-600 ml-2 shrink-0">
          {filtered.length}/{events.length}
        </span>
      </Toolbar>

      <div ref={listRef} className="flex-1 overflow-auto font-mono text-xs" onScroll={handleScroll}>
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full text-neutral-600 text-xs">
            No events
          </div>
        ) : (
          filtered.map((ev) => <EventRow key={ev.id} event={ev} />)
        )}
      </div>
    </div>
  );
}

// ── Event Row ───────────────────────────────────────────────────────

function EventRow({ event }: { event: import("../types").EventBusMessage }) {
  const cat = EVENT_CATEGORIES[event.event] ?? {
    color: "text-neutral-400",
    label: "?",
  };
  const time = new Date(event.ts);
  const ts = `${time.getHours().toString().padStart(2, "0")}:${time.getMinutes().toString().padStart(2, "0")}:${time.getSeconds().toString().padStart(2, "0")}.${time.getMilliseconds().toString().padStart(3, "0")}`;

  return (
    <div className="flex items-start gap-2 px-3 py-1 border-b border-neutral-800/50 hover:bg-neutral-800/50">
      <span className="text-neutral-600 shrink-0 w-20 select-none">{ts}</span>
      <span
        className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 ${cat.color} w-auto min-w-16 text-center`}
      >
        {event.event}
      </span>
      <span className="text-neutral-600 shrink-0 w-20 truncate" title={event.actionId}>
        {event.actionId.slice(0, 8)}
      </span>
      <div className="flex-1 min-w-0 wrap-break-word">
        <ValueRenderer value={event.payload} depth={0} />
      </div>
    </div>
  );
}
