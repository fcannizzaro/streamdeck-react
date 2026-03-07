import { createElement, type CSSProperties, type ReactElement } from "react";

export interface ImageProps {
  className?: string;
  src: string;
  width: number;
  height: number;
  fit?: "contain" | "cover";
  borderRadius?: number;
  style?: CSSProperties;
}

export function Image({
  className,
  src,
  width,
  height,
  fit,
  borderRadius,
  style,
}: ImageProps): ReactElement {
  return createElement("img", {
    className,
    src,
    width,
    height,
    style: {
      ...(fit !== undefined && { objectFit: fit }),
      ...(borderRadius !== undefined && { borderRadius }),
      ...style,
    } satisfies CSSProperties,
  });
}
