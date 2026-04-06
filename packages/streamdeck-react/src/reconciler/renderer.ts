import Reconciler from "react-reconciler";
import { hostConfig } from "./host-config";

// ── Reconciler Instance ─────────────────────────────────────────────
//
// Lazy singleton for the react-reconciler instance.  Previously created
// eagerly at module scope (side effect at import time), which prevented
// bundlers from tree-shaking any module that transitively imported this
// file.
//
// Now deferred to first use via getReconciler().  This follows the same
// get*()/reset*() pattern used by getBufferPool(), getImageCache(), etc.
//
// injectIntoDevTools registers this renderer with React DevTools
// (when the DevTools extension is connected).  bundleType 0 =
// production (no extra validation), 1 = development.

type ReconcilerInstance = ReturnType<typeof Reconciler>;

let _reconciler: ReconcilerInstance | null = null;

/** Get the shared reconciler instance (creates lazily on first access). */
export function getReconciler(): ReconcilerInstance {
  if (_reconciler == null) {
    _reconciler = Reconciler(hostConfig);
    _reconciler.injectIntoDevTools({
      bundleType: process.env.NODE_ENV === "production" ? 0 : 1,
      rendererPackageName: "@fcannizzaro/streamdeck-react",
      version: "0.1.0",
    });
  }
  return _reconciler;
}

/** Reset the reconciler instance (for testing). */
export function resetReconciler(): void {
  _reconciler = null;
}
