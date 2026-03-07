import { createElement, type CSSProperties, type ReactElement, type ReactNode } from "react";

export interface BoxProps {
  className?: string;
  center?: boolean;
  padding?: number;
  background?: string;
  borderRadius?: number;
  gap?: number;
  direction?: "row" | "column";
  style?: CSSProperties;
  children?: ReactNode;
}

export function Box({
  className,
  center,
  padding,
  background,
  borderRadius,
  gap,
  direction,
  style,
  children,
}: BoxProps): ReactElement {
  return createElement(
    "div",
    {
      className,
      style: {
        display: "flex",
        flexDirection: direction ?? "column",
        ...(center && {
          alignItems: "center",
          justifyContent: "center",
        }),
        ...(padding !== undefined && { padding }),
        ...(background !== undefined && { backgroundColor: background }),
        ...(borderRadius !== undefined && { borderRadius }),
        ...(gap !== undefined && { gap }),
        ...style,
      } satisfies CSSProperties,
    },
    children,
  );
}
