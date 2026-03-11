// ── Render Worker ────────────────────────────────────────────────────
//
// Runs in a separate thread via Node.js worker_threads.  Handles the
// full render pipeline: serialized VNode data → Takumi nodes → raster.
//
// Uses the direct VNode → Takumi node bypass (same as main thread's
// vnodeToTakumiNode in pipeline.ts), skipping vnodeToElement() and
// fromJsx() entirely.
//
// This unblocks the main thread during the expensive Takumi
// rasterization step (~5–30ms per frame).
//
// Why code is duplicated (inlined):
//   Worker threads can't import from the main bundle — they load
//   the compiled worker.js file independently.  SVG serialization
//   and VNode→Takumi conversion must be self-contained here.
//   Both mirror the logic in svg.ts and pipeline.ts respectively.
//
// Zero-copy return:
//   The rendered buffer is transferred (not copied) back to the main
//   thread via postMessage's transfer list.  This avoids copying
//   potentially large raster buffers (e.g. 800×100×4 = 320KB for
//   touchbar) across the thread boundary.

import { parentPort, workerData } from "node:worker_threads";

// ── Types ───────────────────────────────────────────────────────────

interface SerializedVNode {
  type: string;
  props: Record<string, unknown>;
  children: SerializedVNode[];
  text?: string;
}

/** Matches @takumi-rs/helpers Node union. Plain object accepted by Renderer.render(). */
interface TakumiNode {
  type: string;
  [key: string]: unknown;
}

interface InitMessage {
  type: "init";
  fonts: Array<{
    name: string;
    data: ArrayBuffer | Buffer;
    weight: number;
    style: string;
  }>;
}

interface RenderMessage {
  type: "render";
  id: number;
  vnodes: SerializedVNode[];
  width: number;
  height: number;
  format: string;
  dpr: number;
}

interface ShutdownMessage {
  type: "shutdown";
}

type WorkerMessage = InitMessage | RenderMessage | ShutdownMessage;

// ── SVG Serialization (inlined for worker context) ──────────────────
// Mirrors the serializeSvgTree() from svg.ts. Inlined to avoid
// cross-module import issues in the worker thread.

const SVG_CAMEL_ATTRS: ReadonlySet<string> = new Set([
  "accentHeight",
  "alignmentBaseline",
  "arabicForm",
  "baselineShift",
  "capHeight",
  "clipPath",
  "clipPathUnits",
  "clipRule",
  "colorInterpolation",
  "colorInterpolationFilters",
  "colorProfile",
  "colorRendering",
  "enableBackground",
  "fillOpacity",
  "fillRule",
  "floodColor",
  "floodOpacity",
  "fontFamily",
  "fontSize",
  "fontSizeAdjust",
  "fontStretch",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "glyphName",
  "glyphOrientationHorizontal",
  "glyphOrientationVertical",
  "horizAdvX",
  "horizOriginX",
  "imageRendering",
  "letterSpacing",
  "lightingColor",
  "markerEnd",
  "markerMid",
  "markerStart",
  "overlinePosition",
  "overlineThickness",
  "paintOrder",
  "pointerEvents",
  "preserveAspectRatio",
  "shapeRendering",
  "stopColor",
  "stopOpacity",
  "strokeDasharray",
  "strokeDashoffset",
  "strokeLinecap",
  "strokeLinejoin",
  "strokeMiterlimit",
  "strokeOpacity",
  "strokeWidth",
  "textAnchor",
  "textDecoration",
  "textRendering",
  "transformOrigin",
  "underlinePosition",
  "underlineThickness",
  "unicodeBidi",
  "unicodeRange",
  "unitsPerEm",
  "vAlphabetic",
  "vHanging",
  "vIdeographic",
  "vMathematical",
  "vectorEffect",
  "vertAdvY",
  "vertOriginX",
  "vertOriginY",
  "wordSpacing",
  "writingMode",
]);

const SVG_SKIP_PROPS: ReadonlySet<string> = new Set([
  "children",
  "key",
  "ref",
  "__self",
  "__source",
]);

function camelToKebab(str: string): string {
  return str.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function serializeSvgStyle(style: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of Object.keys(style)) {
    const value = style[key];
    if (value == null) continue;
    parts.push(`${camelToKebab(key)}:${String(value).trim()}`);
  }
  return parts.join(";");
}

function serializeSvgAttr(key: string, value: unknown): string | null {
  if (SVG_SKIP_PROPS.has(key) || value == null) return null;
  let attrName: string;
  if (key === "className") attrName = "class";
  else if (SVG_CAMEL_ATTRS.has(key)) attrName = camelToKebab(key);
  else attrName = key;
  if (key === "style" && typeof value === "object") {
    const css = serializeSvgStyle(value as Record<string, unknown>);
    if (!css) return null;
    return `${attrName}="${escapeAttr(css)}"`;
  }
  if (typeof value === "boolean") return `${attrName}="${String(value)}"`;
  return `${attrName}="${escapeAttr(String(value))}"`;
}

function serializeSvgVNode(node: SerializedVNode): string {
  if (node.type === "#text") return node.text ?? "";
  const attrs: string[] = [];
  for (const [key, value] of Object.entries(node.props)) {
    const attr = serializeSvgAttr(key, value);
    if (attr != null) attrs.push(attr);
  }
  const childMarkup = node.children.map(serializeSvgVNode).join("");
  const attrStr = attrs.length > 0 ? ` ${attrs.join(" ")}` : "";
  return `<${node.type}${attrStr}>${childMarkup}</${node.type}>`;
}

function serializeSvgTree(svgNode: SerializedVNode): string {
  if (!("xmlns" in svgNode.props)) {
    const augmented = {
      ...svgNode,
      props: { ...svgNode.props, xmlns: "http://www.w3.org/2000/svg" },
    };
    return serializeSvgVNode(augmented);
  }
  return serializeSvgVNode(svgNode);
}

// ── Direct VNode → Takumi Node Conversion ───────────────────────────
// Mirrors the main-thread vnodeToTakumiNode() from pipeline.ts.
// Inlined to avoid cross-module import issues in worker context.

function vnodeToTakumiNode(node: SerializedVNode): TakumiNode {
  // Text nodes → Takumi TextNode
  if (node.type === "#text") {
    return { type: "text", text: node.text ?? "" };
  }

  const { children: _children, className, src, ...restProps } = node.props;

  // Map className → tw (same logic as main thread)
  let tw: string | undefined = typeof restProps.tw === "string" ? restProps.tw : undefined;
  if (typeof className === "string" && className.length > 0) {
    tw = tw ? tw + " " + className : className;
  }

  // Image nodes → Takumi ImageNode
  if (node.type === "img" && typeof src === "string") {
    return {
      type: "image",
      src: src as string,
      ...(tw ? { tw } : {}),
      ...restProps,
    };
  }

  // SVG nodes → Takumi ImageNode (serialize subtree to SVG markup)
  if (node.type === "svg") {
    const svgMarkup = serializeSvgTree(node);
    const width = typeof node.props.width === "number" ? node.props.width : undefined;
    const height = typeof node.props.height === "number" ? node.props.height : undefined;
    return {
      type: "image",
      src: svgMarkup,
      ...(width != null ? { width } : {}),
      ...(height != null ? { height } : {}),
      ...(tw ? { tw } : {}),
      ...(node.props.style ? { style: node.props.style } : {}),
      tagName: "svg",
    };
  }

  // All other nodes → Takumi ContainerNode
  const takumiChildren =
    node.children.length > 0 ? node.children.map(vnodeToTakumiNode) : undefined;

  return {
    type: "container",
    ...(tw ? { tw } : {}),
    ...restProps,
    ...(takumiChildren ? { children: takumiChildren } : {}),
  };
}

// ── Root style constant ─────────────────────────────────────────────

const ROOT_STYLE = { display: "flex", width: "100%", height: "100%" } as const;

// ── Worker State ────────────────────────────────────────────────────

let renderer: import("@takumi-rs/core").Renderer | null = null;

// ── Message Handler ─────────────────────────────────────────────────

async function handleMessage(msg: WorkerMessage): Promise<void> {
  switch (msg.type) {
    case "init": {
      try {
        // Dynamic import — may fail if the native addon can't load in a worker
        const core = await import("@takumi-rs/core");

        renderer = new core.Renderer({
          fonts: msg.fonts.map((f) => ({
            name: f.name,
            data: f.data,
            weight: f.weight as 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900,
            style: f.style as "normal" | "italic",
          })),
        });

        parentPort!.postMessage({ type: "ready" });
      } catch (err) {
        parentPort!.postMessage({
          type: "error",
          id: -1,
          error: `Worker init failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      break;
    }

    case "render": {
      if (renderer == null) {
        parentPort!.postMessage({
          type: "error",
          id: msg.id,
          error: "Worker not initialized",
        });
        return;
      }

      try {
        // 1. Convert serialized VNode data → Takumi nodes directly (bypass fromJsx)
        const children = msg.vnodes.map(vnodeToTakumiNode);
        const rootNode: TakumiNode = {
          type: "container",
          style: ROOT_STYLE,
          children,
        };

        // 2. Render to raster image
        const buffer = await renderer.render(rootNode, {
          width: msg.width,
          height: msg.height,
          format: msg.format as import("@takumi-rs/core").OutputFormat,
          devicePixelRatio: msg.dpr,
        });

        // Transfer the buffer (zero-copy) back to the main thread
        const ab =
          buffer instanceof ArrayBuffer
            ? buffer
            : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

        parentPort!.postMessage(
          { type: "result", id: msg.id, buffer: ab },
          { transfer: [ab as ArrayBuffer] },
        );
      } catch (err) {
        parentPort!.postMessage({
          type: "error",
          id: msg.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      break;
    }

    case "shutdown": {
      process.exit(0);
    }
  }
}

// ── Auto-init if fonts provided via workerData ──────────────────────

if (workerData?.fonts) {
  handleMessage({ type: "init", fonts: workerData.fonts });
}

parentPort!.on("message", (msg: WorkerMessage) => {
  handleMessage(msg);
});
