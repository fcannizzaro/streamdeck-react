import { createElement, type ReactElement } from "react";

// ── VNode: Virtual node in the reconciler tree ──────────────────────

export interface VNode {
  type: string;
  props: Record<string, unknown>;
  children: VNode[];
  text?: string;
}

export interface VContainer {
  children: VNode[];
  scheduledRender: boolean;
  lastSvgHash: number;
  renderCallback: () => void;
  renderTimer: ReturnType<typeof setTimeout> | null;
}

// ── Factory Functions ───────────────────────────────────────────────

export function createVNode(
  type: string,
  props: Record<string, unknown>,
): VNode {
  return { type, props, children: [] };
}

export function createTextVNode(text: string): VNode {
  return { type: "#text", props: {}, children: [], text };
}

export function createVContainer(renderCallback: () => void): VContainer {
  return {
    children: [],
    scheduledRender: false,
    lastSvgHash: 0,
    renderCallback,
    renderTimer: null,
  };
}

// ── Serialization: VNode → React Element ────────────────────────────

export function vnodeToElement(node: VNode): ReactElement | string {
  if (node.type === "#text") {
    return node.text ?? "";
  }

  const { children: _children, className, ...restProps } = node.props;

  // Map className → tw for Takumi's built-in Tailwind parser
  if (typeof className === "string" && className.length > 0) {
    const existingTw =
      typeof restProps.tw === "string" ? restProps.tw + " " : "";
    restProps.tw = existingTw + className;
  }

  const childElements = node.children.map(vnodeToElement);

  return createElement(node.type, restProps, ...childElements);
}
