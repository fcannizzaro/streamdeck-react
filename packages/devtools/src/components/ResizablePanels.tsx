import { useCallback, useEffect, useRef, useState, Fragment, type ReactNode } from "react";

// ── Resizable Split Panels ──────────────────────────────────────────
// Lays out children with draggable dividers between them.
// Supports horizontal (column) and vertical (row) directions.

export type LayoutDirection = "horizontal" | "vertical";

interface PanelDef {
  id: string;
  content: ReactNode;
}

interface Props {
  panels: PanelDef[];
  direction: LayoutDirection;
}

const MIN_FRACTION = 0.05; // 5% minimum per panel
const DIVIDER_SIZE = 5; // px

export function ResizablePanels({ panels, direction }: Props) {
  const count = panels.length;
  const containerRef = useRef<HTMLDivElement>(null);
  const sizesRef = useRef<number[]>([]);
  const [sizes, setSizes] = useState<number[]>([]);

  // Keep ref in sync for use inside drag handlers
  sizesRef.current = sizes;

  const isHorizontal = direction === "horizontal";

  // Reset to equal sizes when panel set changes or direction changes
  useEffect(() => {
    if (count > 0) {
      setSizes(Array(count).fill(1 / count));
    }
  }, [count, direction]);

  const handleDividerMouseDown = useCallback(
    (dividerIndex: number, e: React.MouseEvent) => {
      e.preventDefault();
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const containerSize = isHorizontal ? rect.width : rect.height;
      const dividerCount = count - 1;
      const availableSize = containerSize - dividerCount * DIVIDER_SIZE;

      const startPos = isHorizontal ? e.clientX : e.clientY;
      const startSizes = [...sizesRef.current];

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const currentPos = isHorizontal ? moveEvent.clientX : moveEvent.clientY;
        const deltaRatio = (currentPos - startPos) / availableSize;

        const next = [...startSizes];
        next[dividerIndex] += deltaRatio;
        next[dividerIndex + 1] -= deltaRatio;

        // Clamp
        if (next[dividerIndex] < MIN_FRACTION) {
          next[dividerIndex + 1] -= MIN_FRACTION - next[dividerIndex];
          next[dividerIndex] = MIN_FRACTION;
        }
        if (next[dividerIndex + 1] < MIN_FRACTION) {
          next[dividerIndex] -= MIN_FRACTION - next[dividerIndex + 1];
          next[dividerIndex + 1] = MIN_FRACTION;
        }

        setSizes(next);
      };

      const handleMouseUp = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = isHorizontal ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [count, isHorizontal],
  );

  if (count === 0 || sizes.length !== count) return null;

  return (
    <div ref={containerRef} className={`${isHorizontal ? "flex" : "flex flex-col"} h-full w-full`}>
      {panels.map((panel, i) => (
        <Fragment key={panel.id}>
          <div
            style={{ flex: `${sizes[i] * 1000} 0 0%` }}
            className={`${isHorizontal ? "min-w-0" : "min-h-0"} overflow-hidden ${isHorizontal ? "h-full" : "w-full"}`}
          >
            {panel.content}
          </div>
          {i < count - 1 && (
            <div
              onMouseDown={(e) => handleDividerMouseDown(i, e)}
              className={`shrink-0 bg-neutral-700 hover:bg-blue-500 transition-colors ${
                isHorizontal ? "cursor-col-resize" : "cursor-row-resize"
              }`}
              style={isHorizontal ? { width: DIVIDER_SIZE } : { height: DIVIDER_SIZE }}
            />
          )}
        </Fragment>
      ))}
    </div>
  );
}
