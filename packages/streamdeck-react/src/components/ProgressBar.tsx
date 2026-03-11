// ── ProgressBar Component ───────────────────────────────────────────
//
// Horizontal progress bar rendered as two nested `<div>` elements.
// The outer div provides the track (background color, border radius,
// overflow: hidden to clip the fill).  The inner div's width is set
// as a percentage of value/max, clamped to [0, 100].
//
// Both `satisfies CSSProperties` assertions provide compile-time
// type checking without widening the runtime object type — this
// catches typos in CSS property names at build time.

import { createElement, type CSSProperties, type ReactElement } from "react";

export interface ProgressBarProps {
  className?: string;
  value: number;
  max?: number;
  height?: number;
  color?: string;
  background?: string;
  borderRadius?: number;
  style?: CSSProperties;
}

export function ProgressBar({
  className,
  value,
  max = 100,
  height = 8,
  color = "#4CAF50",
  background = "#333",
  borderRadius = 4,
  style,
}: ProgressBarProps): ReactElement {
  const percent = Math.max(0, Math.min(100, (value / max) * 100));

  return createElement(
    "div",
    {
      className,
      style: {
        display: "flex",
        width: "100%",
        height,
        backgroundColor: background,
        borderRadius,
        overflow: "hidden",
        ...style,
      } satisfies CSSProperties,
    },
    createElement("div", {
      style: {
        width: `${percent}%`,
        height: "100%",
        backgroundColor: color,
        borderRadius,
      } satisfies CSSProperties,
    }),
  );
}
