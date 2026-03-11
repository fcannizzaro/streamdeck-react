// ── Fetch Interceptor ───────────────────────────────────────────────
//
// Wraps globalThis.fetch to capture request/response data for the
// devtools network panel.
//
// Key design constraints:
//   - The ORIGINAL fetch is always called with the ORIGINAL arguments
//     (no mutation of input/init).
//   - Response body is read from a CLONE — the original Response is
//     returned untouched to the caller.
//   - Binary content types (image/*, audio/*, etc.) are skipped to
//     avoid serializing large binary payloads.
//   - Body size is capped at MAX_BODY_BYTES (256KB) to prevent
//     memory bloat from large API responses.
//   - Errors are caught and forwarded — fetch failures are still
//     thrown to the original caller.

const MAX_BODY_BYTES = 256 * 1024; // 256KB

const BINARY_CONTENT_TYPES =
  /^(image|audio|video|application\/octet-stream|application\/zip|application\/pdf)/;

export interface FetchCallback {
  onRequest(
    id: string,
    method: string,
    url: string,
    headers: Record<string, string>,
    body?: string,
  ): void;
  onResponse(
    id: string,
    status: number,
    statusText: string,
    headers: Record<string, string>,
    body: string | undefined,
    durationMs: number,
  ): void;
  onError(id: string, error: string, durationMs: number): void;
}

/**
 * Patches globalThis.fetch to forward request/response data to the devtools bridge.
 * Returns a restore function that undoes the patch.
 */
type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function headersToRecord(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

export function patchFetch(cb: FetchCallback): () => void {
  const original = globalThis.fetch as FetchFn | undefined;
  if (!original) return () => {};

  const wrapper: FetchFn = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const id = crypto.randomUUID();
    const start = Date.now();

    // Build a Request to extract method/url/headers
    let method = "GET";
    let url = "";
    let reqHeaders: Record<string, string> = {};

    try {
      const req = new Request(input, init);
      method = req.method;
      url = req.url;
      reqHeaders = headersToRecord(req.headers);
    } catch {
      // If Request construction fails, extract what we can
      url = typeof input === "string" ? input : input instanceof URL ? input.href : String(input);
      method = init?.method ?? "GET";
    }

    // Capture request body
    let reqBody: string | undefined;
    try {
      if (init?.body) {
        if (typeof init.body === "string") {
          reqBody =
            init.body.length > MAX_BODY_BYTES
              ? init.body.slice(0, MAX_BODY_BYTES) + `\n...[truncated at ${MAX_BODY_BYTES} bytes]`
              : init.body;
        } else {
          reqBody = "[non-string body]";
        }
      }
    } catch {
      /* ignore */
    }

    cb.onRequest(id, method, url, reqHeaders, reqBody);

    try {
      // Call the ORIGINAL fetch with the ORIGINAL arguments
      const response = await original(input, init);
      const duration = Date.now() - start;
      const resHeaders = headersToRecord(response.headers);

      // Capture response body from a clone
      let resBody: string | undefined;
      try {
        resBody = await readBodySafe(response.clone());
      } catch {
        /* ignore */
      }

      cb.onResponse(id, response.status, response.statusText, resHeaders, resBody, duration);

      // Return the ORIGINAL response — never the clone
      return response;
    } catch (err) {
      const duration = Date.now() - start;
      cb.onError(id, err instanceof Error ? err.message : String(err), duration);
      throw err;
    }
  };

  (globalThis as { fetch: FetchFn }).fetch = wrapper;

  return () => {
    (globalThis as { fetch: FetchFn }).fetch = original;
  };
}

// ── Body Reader ─────────────────────────────────────────────────────

async function readBodySafe(reqOrRes: Request | Response): Promise<string | undefined> {
  const contentType = reqOrRes.headers.get("content-type") ?? "";
  const contentLength = Number(reqOrRes.headers.get("content-length") || 0);

  // Skip binary content types
  if (BINARY_CONTENT_TYPES.test(contentType)) {
    return `[binary: ${contentType}${contentLength ? `, ${contentLength} bytes` : ""}]`;
  }

  // Skip if Content-Length exceeds limit
  if (contentLength > MAX_BODY_BYTES) {
    return `[body too large: ${contentLength} bytes, limit ${MAX_BODY_BYTES}]`;
  }

  try {
    const text = await reqOrRes.text();
    if (text.length > MAX_BODY_BYTES) {
      return text.slice(0, MAX_BODY_BYTES) + `\n...[truncated at ${MAX_BODY_BYTES} bytes]`;
    }
    return text;
  } catch {
    return "[body read error]";
  }
}
