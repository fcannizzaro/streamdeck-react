import { createElement, type ReactElement } from "react";
import { fromJsx } from "@takumi-rs/helpers/jsx";
import type { VContainer, VNode } from "@/reconciler/vnode";
import { bufferToDataUri, type RenderConfig } from "@/render/pipeline";

// ── Highlight Overlay Renderer ──────────────────────────────────────
// Re-renders a VNode tree with a cyan border + opacity fill on a
// specific node (matched by its serialization nid). Intentionally
// skips caching and the onRender callback to avoid feedback loops.

const HIGHLIGHT_BORDER_COLOR = "cyan";
const HIGHLIGHT_BORDER_WIDTH = 2;
const HIGHLIGHT_BG = "rgba(0, 255, 255, 0.2)";

export async function renderWithHighlight(
  container: VContainer,
  width: number,
  height: number,
  config: RenderConfig,
  targetNid: number,
): Promise<string | null> {
  if (container.children.length === 0) return null;

  // Walk the tree with a counter matching serialization nid order.
  // nid 0 = the container itself; children start at nid 1.
  const counter = { value: 0 };

  // Skip nid 0 (the container wrapper)
  counter.value++;

  const rootChildren = container.children.map((child) =>
    vnodeToElementHighlighted(child, targetNid, counter),
  );

  const rootElement = createElement(
    "div",
    {
      style: {
        display: "flex",
        width: "100%",
        height: "100%",
      },
    },
    ...rootChildren,
  );

  const { node, stylesheets } = await fromJsx(rootElement);

  const buffer = await config.renderer.render(node, {
    width,
    height,
    format: config.imageFormat,
    stylesheets,
    devicePixelRatio: config.devicePixelRatio,
  });

  return bufferToDataUri(buffer, config.imageFormat);
}

// ── VNode → React Element with highlight ────────────────────────────
// Same DFS traversal order as serialization/vnode.ts so nid values match.

function vnodeToElementHighlighted(
  node: VNode,
  targetNid: number,
  counter: { value: number },
): ReactElement | string {
  const nid = counter.value++;
  const isTarget = nid === targetNid;

  if (node.type === "#text") {
    if (isTarget) {
      // Wrap highlighted text in a span with highlight styles
      return createElement("span", {
        style: {
          borderWidth: HIGHLIGHT_BORDER_WIDTH,
          borderStyle: "solid",
          borderColor: HIGHLIGHT_BORDER_COLOR,
          backgroundColor: HIGHLIGHT_BG,
        },
      }, node.text ?? "");
    }
    return node.text ?? "";
  }

  const { children: _children, className, ...restProps } = node.props;

  // Map className → tw (same as vnodeToElement in vnode.ts)
  if (typeof className === "string" && className.length > 0) {
    const existingTw =
      typeof restProps.tw === "string" ? restProps.tw + " " : "";
    restProps.tw = existingTw + className;
  }

  // Recurse into children with the shared counter
  const childElements = node.children.map((child) =>
    vnodeToElementHighlighted(child, targetNid, counter),
  );

  if (isTarget) {
    // Wrap the target in a <div> with position:relative and place the
    // highlight overlay as a sibling.  This avoids nesting a block <div>
    // inside an inline element (e.g. <span>), which causes the Takumi
    // native renderer to panic on invalid HTML.
    return createElement(
      "div",
      { style: { position: "relative" } },
      createElement(node.type, restProps, ...childElements),
      createElement("div", {
        style: {
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          borderWidth: HIGHLIGHT_BORDER_WIDTH,
          borderStyle: "solid",
          borderColor: HIGHLIGHT_BORDER_COLOR,
          backgroundColor: HIGHLIGHT_BG,
        },
      }),
    );
  }

  return createElement(node.type, restProps, ...childElements);
}
