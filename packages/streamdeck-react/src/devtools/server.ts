import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { BaseMessage, ClientMessage } from "./types";
import { origConsole } from "./intercepts/console";

// ── DevTools HTTP + SSE Server ─────────────────────────────────────
// Runs an HTTP server inside the plugin.
//   GET  /health  → quick probe endpoint for port scanning
//   GET  /events  → SSE stream (server → browser)
//   POST /message → client → server messages (JSON body)

const PORT_MIN = 39400;
const PORT_MAX = 39499;
const MAX_RETRIES = 10;

let clientIdCounter = 0;

export class DevtoolsServer {
  private httpServer: Server | null = null;
  private clients = new Map<string, ServerResponse>();
  private port: number;
  private actualPort: number | null = null;

  private onConnectCb: ((clientId: string) => void) | null = null;
  private onMessageCb: ((msg: ClientMessage) => void) | null = null;

  constructor(port: number) {
    this.port = port;
  }

  /** Set a callback invoked when a new browser client connects via SSE. */
  setOnConnect(cb: (clientId: string) => void): void {
    this.onConnectCb = cb;
  }

  /** Set a callback for client→server messages (request:snapshot, highlight:action). */
  setOnMessage(cb: (msg: ClientMessage) => void): void {
    this.onMessageCb = cb;
  }

  /** Start listening. Tries the configured port, then random ports in range on EADDRINUSE. */
  async start(): Promise<void> {
    let port = this.port;
    let retries = 0;

    while (retries < MAX_RETRIES) {
      try {
        await this.listen(port);
        this.actualPort = port;
        origConsole.log(
          `[@fcannizzaro/streamdeck-react] DevTools server listening on http://127.0.0.1:${port}`,
        );
        return;
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
          retries++;
          port = PORT_MIN + Math.floor(Math.random() * (PORT_MAX - PORT_MIN + 1));
          continue;
        }
        throw err;
      }
    }

    origConsole.error(
      `[@fcannizzaro/streamdeck-react] DevTools server failed to find an open port after ${MAX_RETRIES} retries`,
    );
  }

  /** Stop the server and disconnect all clients. */
  stop(): void {
    for (const [id, res] of this.clients) {
      try {
        res.end();
      } catch {
        // ignore
      }
    }
    this.clients.clear();
    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
    }
  }

  /** Whether any browser devtools clients are connected. Fast-path guard to skip serialization. */
  hasClients(): boolean {
    return this.clients.size > 0;
  }

  /** The port the server is actually listening on (null if not started). */
  getPort(): number | null {
    return this.actualPort;
  }

  /** Send a message to a specific client (by ID). */
  send(clientId: string, message: BaseMessage): void {
    const res = this.clients.get(clientId);
    if (!res || res.writableEnded) return;
    try {
      res.write(`data: ${JSON.stringify(message)}\n\n`);
    } catch {
      // Ignore send errors
    }
  }

  /** Broadcast a message to all connected SSE clients. */
  broadcast(message: BaseMessage): void {
    if (this.clients.size === 0) return;
    const data = `data: ${JSON.stringify(message)}\n\n`;
    for (const [id, res] of this.clients) {
      if (!res.writableEnded) {
        try {
          res.write(data);
        } catch {
          this.clients.delete(id);
        }
      }
    }
  }

  // ── Internal ──────────────────────────────────────────────────

  private listen(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => this.handleRequest(req, res));

      server.on("listening", () => {
        this.httpServer = server;
        resolve();
      });

      server.on("error", (err) => {
        reject(err);
      });

      server.listen(port, "127.0.0.1");
    });
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    // CORS headers — devtools UI may be on a different origin
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Parse pathname (req.url is like "/health" or "/events?...")
    const pathname = (req.url ?? "/").split("?")[0];

    if (req.method === "GET" && pathname === "/health") {
      this.handleHealth(res);
      return;
    }

    if (req.method === "GET" && pathname === "/events") {
      this.handleSSE(req, res);
      return;
    }

    if (pathname === "/message") {
      if (req.method === "GET") {
        this.handleGetMessage(req, res);
        return;
      }
      if (req.method === "POST") {
        this.handlePostMessage(req, res);
        return;
      }
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  }

  /** GET /health — lightweight probe endpoint for port scanning. */
  private handleHealth(res: ServerResponse): void {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  }

  /** GET /events — SSE stream for server→client messages. */
  private handleSSE(req: IncomingMessage, res: ServerResponse): void {
    const clientId = `c${++clientIdCounter}`;

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    // Send an initial comment to flush headers / confirm connection
    res.write(":ok\n\n");

    this.clients.set(clientId, res);

    // Notify bridge (sends server:info + snapshot to this client)
    this.onConnectCb?.(clientId);

    req.on("close", () => {
      this.clients.delete(clientId);
    });
  }

  /**
   * GET /message?d=<json> — fire-and-forget client→server messages.
   * Used via `new Image().src` to bypass CORS/PNA preflight entirely.
   * Returns a 1x1 transparent GIF.
   */
  private handleGetMessage(req: IncomingMessage, res: ServerResponse): void {
    const qs = (req.url ?? "").split("?")[1] ?? "";
    const params = new URLSearchParams(qs);
    const data = params.get("d");
    if (data) {
      try {
        const msg = JSON.parse(data) as ClientMessage;
        this.onMessageCb?.(msg);
      } catch {
        // ignore malformed
      }
    }
    // 1x1 transparent GIF — smallest valid image response
    const pixel = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
    res.writeHead(200, {
      "Content-Type": "image/gif",
      "Content-Length": String(pixel.length),
      "Cache-Control": "no-store",
    });
    res.end(pixel);
  }

  /** POST /message — client→server messages (JSON body). Fallback for programmatic use. */
  private handlePostMessage(req: IncomingMessage, res: ServerResponse): void {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      try {
        const msg = JSON.parse(body) as ClientMessage;
        this.onMessageCb?.(msg);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Bad Request");
      }
    });
  }
}
