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
