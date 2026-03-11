import { createElement, type CSSProperties } from "react";

// ── Circular Gauge Component ────────────────────────────────────────
//
// SVG-based circular progress indicator.  Renders as an <svg> element,
// which Takumi serializes to a markup string and rasterizes as an
// ImageNode (see svg.ts for the serialization path).
//
// The arc is drawn using strokeDasharray/strokeDashoffset on a circle:
//   circumference = 2π × radius
//   dashoffset = circumference × (1 - percent/100)
// The circle is rotated -90° so the arc starts at 12 o'clock.

export interface CircularGaugeProps {
  className?: string;
  value: number;
  max?: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  background?: string;
  style?: CSSProperties;
}

export function CircularGauge({
  className,
  value,
  max = 100,
  size = 80,
  strokeWidth = 6,
  color = "#2196F3",
  background = "#333",
  style,
}: CircularGaugeProps) {
  const percent = Math.max(0, Math.min(100, (value / max) * 100));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percent / 100) * circumference;
  const center = size / 2;

  return createElement(
    "svg",
    {
      className,
      width: size,
      height: size,
      viewBox: `0 0 ${size} ${size}`,
      style,
    },
    // Background circle
    createElement("circle", {
      cx: center,
      cy: center,
      r: radius,
      fill: "none",
      stroke: background,
      strokeWidth,
    }),
    // Foreground arc
    createElement("circle", {
      cx: center,
      cy: center,
      r: radius,
      fill: "none",
      stroke: color,
      strokeWidth,
      strokeDasharray: `${circumference}`,
      strokeDashoffset: `${strokeDashoffset}`,
      strokeLinecap: "round",
      transform: `rotate(-90 ${center} ${center})`,
    }),
  );
}
