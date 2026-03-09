import { createServer, type Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { BaseMessage, ClientMessage } from "./types";
import { origConsole } from "./intercepts/console";

// ── DevTools WebSocket Server ──────────────────────────────────────────
// Runs a WebSocket server inside the plugin using the `ws` npm package.
// Browser devtools UIs discover the server by scanning the port range.

const PORT_MIN = 39400;
const PORT_MAX = 39499;
const MAX_RETRIES = 10;

export class DevtoolsServer {
  private wss: WebSocketServer | null = null;
  private httpServer: Server | null = null;
  private clients = new Set<WebSocket>();
  private port: number;
  private actualPort: number | null = null;

  private onConnectCb: ((ws: WebSocket) => void) | null = null;
  private onMessageCb: ((msg: ClientMessage) => void) | null = null;

  constructor(port: number) {
    this.port = port;
  }

  /** Set a callback invoked when a new browser client connects. */
  setOnConnect(cb: (ws: WebSocket) => void): void {
    this.onConnectCb = cb;
  }

  /** Set a callback for client→server messages (request:snapshot, ping). */
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
          `[@fcannizzaro/streamdeck-react] DevTools server listening on ws://127.0.0.1:${port}`,
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
    for (const ws of this.clients) {
      try {
        ws.close();
      } catch {
        // ignore
      }
    }
    this.clients.clear();
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
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

  /** Send a message to a specific client. */
  send(ws: WebSocket, message: BaseMessage): void {
    if (ws.readyState !== ws.OPEN) return;
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // Ignore send errors
    }
  }

  /** Broadcast a message to all connected clients. */
  broadcast(message: BaseMessage): void {
    if (this.clients.size === 0) return;
    const json = JSON.stringify(message);
    for (const ws of this.clients) {
      if (ws.readyState === ws.OPEN) {
        try {
          ws.send(json);
        } catch {
          // Ignore send errors
        }
      }
    }
  }

  // ── Internal ──────────────────────────────────────────────────

  private isAllowedOrigin(origin: string | undefined): boolean {
    if (!origin) return false;
    try {
      const url = new URL(origin);
      // Allow localhost (any port) and the hosted devtools site
      return (
        url.hostname === "localhost" ||
        url.hostname === "127.0.0.1" ||
        url.hostname === "streamdeckreact.fcannizzaro.com"
      );
    } catch {
      return false;
    }
  }

  private listen(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const httpServer = createServer((req, res) => {
        const origin = req.headers.origin;

        // Reject requests from disallowed origins
        if (origin && !this.isAllowedOrigin(origin)) {
          res.writeHead(403);
          res.end();
          return;
        }

        // ── PNA / CORS preflight ──────────────────────────────────
        // Browsers send an OPTIONS request before allowing WebSocket
        // connections from a public HTTPS origin to a local address.
        if (req.method === "OPTIONS") {
          res.writeHead(204, {
            "Access-Control-Allow-Origin": origin || "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "*",
            "Access-Control-Allow-Private-Network": "true",
            "Access-Control-Max-Age": "86400",
          });
          res.end();
          return;
        }

        // Basic informational response for direct HTTP access
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("streamdeck-react devtools server");
      });

      const wss = new WebSocketServer({ noServer: true });

      httpServer.on("upgrade", (req, socket, head) => {
        // Validate origin on WebSocket upgrade requests too
        const origin = req.headers.origin;
        if (origin && !this.isAllowedOrigin(origin)) {
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit("connection", ws, req);
        });
      });

      httpServer.on("listening", () => {
        this.wss = wss;
        this.httpServer = httpServer;
        this.setupConnectionHandler(wss);
        resolve();
      });

      httpServer.on("error", (err) => {
        reject(err);
      });

      httpServer.listen(port, "127.0.0.1");
    });
  }

  private setupConnectionHandler(wss: WebSocketServer): void {
    wss.on("connection", (ws: WebSocket) => {
      this.clients.add(ws);

      // Notify bridge (sends server:info + snapshot to this client)
      this.onConnectCb?.(ws);

      ws.on("message", (raw) => {
        try {
          const msg = JSON.parse(raw.toString()) as ClientMessage;
          this.onMessageCb?.(msg);
        } catch {
          // Ignore malformed messages
        }
      });

      ws.on("close", () => {
        this.clients.delete(ws);
      });

      ws.on("error", () => {
        // close will follow
      });
    });
  }
}
