// ── Icon Component ──────────────────────────────────────────────────
//
// Renders a single SVG `<path>` inside an `<svg>` element.  Designed
// for Material Design Icons (MDI) and similar icon sets that expose
// icons as SVG path data strings.
//
// In the render pipeline (pipeline.ts vnodeToTakumiNode), the `<svg>`
// VNode subtree is serialized to SVG markup via serializeSvgTree()
// and wrapped in a Takumi ImageNode — so the SVG is rasterized by
// Takumi's native renderer, not a browser engine.

import { createElement, type CSSProperties } from "react";

export interface IconProps {
  className?: string;
  path: string;
  size?: number;
  color?: string;
  viewBox?: string;
  style?: CSSProperties;
}

export function Icon({
  className,
  path,
  size = 24,
  color = "white",
  viewBox = "0 0 24 24",
  style,
}: IconProps) {
  return createElement(
    "svg",
    {
      className,
      width: size,
      height: size,
      viewBox,
      style,
    },
    createElement("path", {
      d: path,
      fill: color,
    }),
  );
}
