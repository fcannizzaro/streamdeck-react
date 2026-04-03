// ── Render Pool ─────────────────────────────────────────────────────
//
// Offloads Takumi rasterization to a worker thread so the main thread
// stays responsive for SDK event handling and React reconciliation.
//
// Why: Takumi's native rasterization (Rust via NAPI) blocks the main
// thread for 5–30ms per frame.  During 30fps TouchStrip animation, this
// leaves almost no time for event processing.  The worker thread runs
// the expensive render in parallel while the main thread continues
// processing keyDown/dialRotate events.
//
// Communication protocol:
//
//   Main thread                    Worker thread
//   ──────────                    ─────────────
//   new Worker(worker.js)    →    workerData.fonts → init Takumi
//                             ←    { type: "ready" }
//   { type: "render",        →    VNode→TakumiNode→render
//     id, vnodes, w, h, fmt }
//                             ←    { type: "result", id, buffer }
//                                  (ArrayBuffer transferred, zero-copy)
//
// Serialization boundary:
//   VNodes contain back-pointers (_parent) and function props that
//   can't cross the structured clone boundary.  serializeVNode()
//   strips these before postMessage.  The worker reconstructs Takumi
//   nodes from the serialized data.
//
// Fallback: if the worker fails to initialize (native addon can't
// load in worker context), the pool marks itself as failed and the
// pipeline falls back to main-thread rendering transparently.

import { Worker } from "node:worker_threads";
import type { FontConfig } from "@/types";
import type { VNode } from "@/reconciler/vnode";

// ── Serialization ───────────────────────────────────────────────────
// Strips internal fields (_parent, _dirty, _hash, _hashValid) and
// function/symbol props from VNodes for worker transfer.  Functions
// can't be serialized via structured clone, and they don't affect
// visual output (event handlers, refs, etc.).

interface SerializedVNode {
  type: string;
  props: Record<string, unknown>;
  children: SerializedVNode[];
  text?: string;
}

/** Strip internal fields and function props from a VNode tree for worker transfer. */
function serializeVNode(node: VNode): SerializedVNode {
  // Strip function/symbol props (they don't affect visual output and can't be serialized)
  const cleanProps: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node.props)) {
    if (typeof value !== "function" && typeof value !== "symbol") {
      cleanProps[key] = value;
    }
  }

  return {
    type: node.type,
    props: cleanProps,
    children: node.children.map(serializeVNode),
    text: node.text,
  };
}

// ── Pending Request ─────────────────────────────────────────────────

interface PendingRequest {
  resolve: (buffer: Buffer) => void;
  reject: (error: Error) => void;
}

// ── RenderPool ──────────────────────────────────────────────────────

export class RenderPool {
  private worker: Worker | null = null;
  private ready = false;
  private failed = false;
  private nextId = 0;
  private pending = new Map<number, PendingRequest>();
  private initPromise: Promise<void> | null = null;

  // Font data stored as SharedArrayBuffer so the worker thread can
  // reference the same memory instead of receiving a structured-clone
  // copy.  This saves ~1-4 MB (the full size of all font files) that
  // would otherwise be duplicated in the worker's V8 heap.
  private sharedFonts: Array<{
    name: string;
    data: SharedArrayBuffer;
    weight: FontConfig["weight"];
    style: FontConfig["style"];
  }>;

  constructor(fonts: FontConfig[]) {
    // Convert font data to SharedArrayBuffer upfront.  The conversion
    // copies each font once (unavoidable — ArrayBuffer → SAB requires
    // a copy), but from this point forward both the main thread and
    // the worker reference the same underlying memory.
    this.sharedFonts = fonts.map((f) => {
      const source = f.data instanceof ArrayBuffer ? new Uint8Array(f.data) : new Uint8Array(f.data);
      const sab = new SharedArrayBuffer(source.byteLength);
      new Uint8Array(sab).set(source);
      return { name: f.name, data: sab, weight: f.weight, style: f.style };
    });
  }

  /** Start the worker. Call once during plugin initialization. */
  async initialize(): Promise<boolean> {
    if (this.ready) return true;
    if (this.failed) return false;
    if (this.initPromise != null) {
      await this.initPromise;
      return this.ready;
    }

    this.initPromise = this.doInitialize();
    await this.initPromise;
    return this.ready;
  }

  private async doInitialize(): Promise<void> {
    try {
      const workerUrl = new URL("./worker.js", import.meta.url);

      this.worker = new Worker(workerUrl, {
        workerData: {
          // SharedArrayBuffer font data — the worker receives references
          // to the same memory, avoiding a structured-clone copy.
          fonts: this.sharedFonts,
        },
      });

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Worker initialization timed out (5s)"));
        }, 5000);

        const onMessage = (msg: { type: string; id?: number; error?: string }) => {
          if (msg.type === "ready") {
            clearTimeout(timeout);
            this.worker!.off("message", onMessage);
            this.worker!.off("error", onError);
            resolve();
          } else if (msg.type === "error" && msg.id === -1) {
            clearTimeout(timeout);
            this.worker!.off("message", onMessage);
            this.worker!.off("error", onError);
            reject(new Error(msg.error ?? "Unknown worker init error"));
          }
        };

        const onError = (err: Error) => {
          clearTimeout(timeout);
          reject(err);
        };

        this.worker!.on("message", onMessage);
        this.worker!.on("error", onError);
      });

      // Set up the persistent message handler for render responses
      this.worker.on("message", this.handleResponse.bind(this));

      // Handle unexpected worker exit
      this.worker.on("exit", (code) => {
        if (code !== 0) {
          console.warn(`[@fcannizzaro/streamdeck-react] Render worker exited with code ${code}`);
        }
        this.handleWorkerDeath();
      });

      this.worker.on("error", (err) => {
        console.error("[@fcannizzaro/streamdeck-react] Render worker error:", err);
        this.handleWorkerDeath();
      });

      this.ready = true;
    } catch (err) {
      console.warn(
        "[@fcannizzaro/streamdeck-react] Worker initialization failed, falling back to main-thread rendering:",
        err instanceof Error ? err.message : err,
      );
      this.failed = true;
      this.worker?.terminate().catch(() => {});
      this.worker = null;
    }
  }

  /** Whether the worker is available for offloaded rendering. */
  get isAvailable(): boolean {
    return this.ready && this.worker != null;
  }

  /**
   * Render VNode children in the worker thread.
   * Returns the raw raster buffer.
   *
   * Lazy initialization: if the worker hasn't been initialized yet,
   * the first render() call triggers initialization automatically.
   * This defers the cost of loading the native Rust addon in a
   * second thread (~12-18 MB) until rendering actually begins.
   */
  async render(
    vnodes: VNode[],
    width: number,
    height: number,
    format: string,
    dpr: number,
  ): Promise<Buffer> {
    // Lazy init: first render call triggers worker initialization
    if (!this.ready && !this.failed) {
      await this.initialize();
    }

    if (!this.isAvailable) {
      throw new Error("Worker not available");
    }

    const id = this.nextId++;
    const serialized = vnodes.map(serializeVNode);

    return new Promise<Buffer>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });

      this.worker!.postMessage({
        type: "render",
        id,
        vnodes: serialized,
        width,
        height,
        format,
        dpr,
      });
    });
  }

  // ── Internal ────────────────────────────────────────────────────

  private handleResponse(msg: {
    type: string;
    id: number;
    buffer?: ArrayBuffer;
    error?: string;
  }): void {
    if (msg.type === "ready") return; // Already handled during init

    const req = this.pending.get(msg.id);
    if (req == null) return;
    this.pending.delete(msg.id);

    if (msg.type === "result" && msg.buffer != null) {
      req.resolve(Buffer.from(msg.buffer));
    } else if (msg.type === "error") {
      req.reject(new Error(msg.error ?? "Unknown worker render error"));
    }
  }

  private handleWorkerDeath(): void {
    this.ready = false;
    this.worker = null;

    // Reject all pending requests
    for (const [_, req] of this.pending) {
      req.reject(new Error("Worker died unexpectedly"));
    }
    this.pending.clear();
  }
}
