import type { NetworkEntry } from "../types";

// ── Network Detail View ─────────────────────────────────────────────

export function NetworkDetail({ entry }: { entry: NetworkEntry | null }) {
  if (!entry) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-neutral-600">
        Select a request to inspect
      </div>
    );
  }

  const { request, response, error } = entry;

  return (
    <div className="text-xs overflow-auto h-full p-3 space-y-4">
      {/* General */}
      <Section title="General">
        <Row label="URL" value={request.url} />
        <Row label="Method" value={request.method} />
        <Row
          label="Status"
          value={
            response
              ? `${response.status} ${response.statusText}`
              : error
                ? `Error: ${error.error}`
                : "Pending..."
          }
        />
        <Row
          label="Duration"
          value={response ? `${response.durationMs}ms` : error ? `${error.durationMs}ms` : "-"}
        />
      </Section>

      {/* Request Headers */}
      <Section title="Request Headers">
        <Headers headers={request.headers} />
      </Section>

      {/* Response Headers */}
      {response && (
        <Section title="Response Headers">
          <Headers headers={response.headers} />
        </Section>
      )}

      {/* Request Body */}
      {request.body && (
        <Section title="Request Body">
          <BodyView body={request.body} />
        </Section>
      )}

      {/* Response Body */}
      {response?.body && (
        <Section title="Response Body">
          <BodyView body={response.body} />
        </Section>
      )}

      {/* Error */}
      {error && (
        <Section title="Error">
          <span className="text-red-400">{error.error}</span>
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-neutral-400 font-bold mb-1 uppercase tracking-wide text-[10px]">
        {title}
      </div>
      <div className="pl-2">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 py-0.5">
      <span className="text-neutral-500 shrink-0 w-20">{label}:</span>
      <span className="text-neutral-200 break-all">{value}</span>
    </div>
  );
}

function Headers({ headers }: { headers: Record<string, string> }) {
  const entries = Object.entries(headers);
  if (entries.length === 0) return <span className="text-neutral-600">None</span>;
  return (
    <div className="space-y-0.5">
      {entries.map(([key, val]) => (
        <div key={key} className="flex gap-2">
          <span className="text-purple-300 shrink-0">{key}:</span>
          <span className="text-neutral-300 break-all">{val}</span>
        </div>
      ))}
    </div>
  );
}

function BodyView({ body }: { body: string }) {
  // Try to parse as JSON for pretty display
  try {
    const parsed = JSON.parse(body);
    return (
      <pre className="bg-neutral-800 rounded p-2 overflow-auto max-h-64 text-neutral-300 whitespace-pre-wrap">
        {JSON.stringify(parsed, null, 2)}
      </pre>
    );
  } catch {
    return (
      <pre className="bg-neutral-800 rounded p-2 overflow-auto max-h-64 text-neutral-300 whitespace-pre-wrap">
        {body}
      </pre>
    );
  }
}
