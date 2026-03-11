import Reconciler from "react-reconciler";
import { hostConfig } from "./host-config";

// ── Reconciler Instance ─────────────────────────────────────────────
// Creates the concrete reconciler by binding our VNode-based host
// config to react-reconciler's internal fiber machinery.  This
// instance is used by ReactRoot and TouchStripRoot to create/update
// fiber roots.
//
// injectIntoDevTools registers this renderer with React DevTools
// (when the DevTools extension is connected).  bundleType 0 =
// production (no extra validation), 1 = development.

export const reconciler = Reconciler(hostConfig);

reconciler.injectIntoDevTools({
  bundleType: process.env.NODE_ENV === "production" ? 0 : 1,
  rendererPackageName: "@fcannizzaro/streamdeck-react",
  version: "0.1.0",
});
