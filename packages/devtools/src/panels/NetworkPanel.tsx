import { useState, useMemo } from "react";
import { useStore } from "../hooks/useStore";
import { Toolbar } from "../components/Toolbar";
import { NetworkDetail } from "../components/NetworkDetail";

// ── Network Panel ───────────────────────────────────────────────────

export function NetworkPanel() {
  const networkRequests = useStore((s) => s.networkRequests);
  const networkOrder = useStore((s) => s.networkOrder);
  const selectedRequestId = useStore((s) => s.selectedRequestId);
  const setSelectedRequest = useStore((s) => s.setSelectedRequest);
  const clearNetwork = useStore((s) => s.clearNetwork);
  const [search, setSearch] = useState("");

  const selectedEntry = selectedRequestId
    ? networkRequests.get(selectedRequestId) ?? null
    : null;

  const filteredOrder = useMemo(() => {
    if (!search) return networkOrder;
    const lower = search.toLowerCase();
    return networkOrder.filter((id) => {
      const entry = networkRequests.get(id);
      return entry?.request.url.toLowerCase().includes(lower);
    });
  }, [networkOrder, networkRequests, search]);

  return (
    <div className="flex flex-col h-full">
      <Toolbar
        search={search}
        onSearchChange={setSearch}
        onClear={clearNetwork}
      >
        <span className="text-[10px] text-neutral-600 ml-2">
          {filteredOrder.length} requests
        </span>
      </Toolbar>

      <div className="flex flex-1 min-h-0">
        {/* Request list */}
        <div className="w-1/2 border-r border-neutral-800 overflow-auto">
          {filteredOrder.length === 0 ? (
            <div className="flex items-center justify-center h-full text-neutral-600 text-xs">
              No network requests
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-neutral-900 text-neutral-500 text-left">
                <tr>
                  <th className="px-2 py-1 font-normal w-14">Status</th>
                  <th className="px-2 py-1 font-normal w-14">Method</th>
                  <th className="px-2 py-1 font-normal">URL</th>
                  <th className="px-2 py-1 font-normal w-16 text-right">Time</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrder.map((id) => {
                  const entry = networkRequests.get(id);
                  if (!entry) return null;
                  return (
                    <RequestRow
                      key={id}
                      entry={entry}
                      isSelected={selectedRequestId === id}
                      onClick={() => setSelectedRequest(id)}
                    />
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Detail pane */}
        <div className="w-1/2 overflow-auto">
          <NetworkDetail entry={selectedEntry} />
        </div>
      </div>
    </div>
  );
}

// ── Request Row ─────────────────────────────────────────────────────

function RequestRow({
  entry,
  isSelected,
  onClick,
}: {
  entry: import("../types").NetworkEntry;
  isSelected: boolean;
  onClick: () => void;
}) {
  const { request, response, error } = entry;

  let statusText: string;
  let statusColor: string;

  if (error) {
    statusText = "ERR";
    statusColor = "text-red-400";
  } else if (response) {
    statusText = String(response.status);
    if (response.status >= 200 && response.status < 300) {
      statusColor = "text-green-400";
    } else if (response.status >= 300 && response.status < 400) {
      statusColor = "text-yellow-400";
    } else {
      statusColor = "text-red-400";
    }
  } else {
    statusText = "...";
    statusColor = "text-neutral-500";
  }

  const duration = response
    ? `${response.durationMs}ms`
    : error
      ? `${error.durationMs}ms`
      : "-";

  // Extract pathname from URL for display
  let displayUrl = request.url;
  try {
    const parsed = new URL(request.url);
    displayUrl = parsed.pathname + parsed.search;
  } catch {
    // use full url
  }

  return (
    <tr
      className={`cursor-pointer hover:bg-neutral-800 ${
        isSelected ? "bg-blue-900/30" : ""
      }`}
      onClick={onClick}
    >
      <td className={`px-2 py-1 ${statusColor}`}>{statusText}</td>
      <td className="px-2 py-1 text-neutral-400">{request.method}</td>
      <td className="px-2 py-1 text-neutral-300 truncate max-w-0" title={request.url}>
        {displayUrl}
      </td>
      <td className="px-2 py-1 text-neutral-500 text-right">{duration}</td>
    </tr>
  );
}
