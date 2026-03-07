import { createElement, type CSSProperties, type ReactElement, type ReactNode } from "react";

export interface TextProps {
  className?: string;
  size?: number;
  color?: string;
  weight?: number;
  align?: "left" | "center" | "right";
  font?: string;
  lineHeight?: number;
  style?: CSSProperties;
  children?: ReactNode;
}

export function Text({
  className,
  size,
  color,
  weight,
  align,
  font,
  lineHeight,
  style,
  children,
}: TextProps): ReactElement {
  return createElement(
    "span",
    {
      className,
      style: {
        ...(size !== undefined && { fontSize: size }),
        ...(color !== undefined && { color }),
        ...(weight !== undefined && { fontWeight: weight }),
        ...(align !== undefined && { textAlign: align }),
        ...(font !== undefined && { fontFamily: font }),
        ...(lineHeight !== undefined && { lineHeight }),
        ...style,
      } satisfies CSSProperties,
    },
    children,
  );
}
