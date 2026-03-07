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
