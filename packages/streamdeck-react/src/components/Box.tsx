// ── Box Component ───────────────────────────────────────────────────
//
// Convenience flex container for Stream Deck layouts.  Uses the
// conditional spread pattern (`...(prop !== undefined && { cssProp: prop })`)
// to build a style object that only includes properties the caller
// explicitly set — omitted props fall through to Takumi's defaults
// or can be overridden via `className` (Tailwind) or `style`.
//
// Why createElement instead of JSX:
//   The library ships as compiled JS — using createElement directly
//   avoids requiring a JSX transform in the build pipeline.

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
