import { useMemo } from "react";
import { useCanvas } from "./context";
import { calcSize } from "@/size/index";
import type { SizeHelper } from "@/size/index";

// ── useSize Hook ────────────────────────────────────────────────────
//
// Context-aware size helper that reads canvas dimensions from the
// current root context (via useCanvas) and returns a SizeHelper with
// percentage-based and proportional size calculation methods.
//
// The SizeHelper is memoized on canvas dimensions — since CanvasInfo
// is stable for the lifetime of a root, the helper is created once
// per root mount and never recomputed.

/**
 * Returns a size helper bound to the current canvas dimensions.
 *
 * @example
 * ```tsx
 * function MyKey() {
 *   const size = useSize();
 *   return (
 *     <div style={{ fontSize: size.scale(24) }}>
 *       {size.square ? "Key" : "Dial"}
 *     </div>
 *   );
 * }
 * ```
 */
export function useSize(): SizeHelper {
  const canvas = useCanvas();
  return useMemo(() => calcSize(canvas.width, canvas.height), [canvas.width, canvas.height]);
}
