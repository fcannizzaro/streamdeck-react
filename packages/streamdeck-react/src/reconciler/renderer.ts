import Reconciler from "react-reconciler";
import { hostConfig } from "./host-config.ts";

// ── Create the Reconciler Instance ──────────────────────────────────

export const reconciler = Reconciler(hostConfig);

// Enable batched updates
reconciler.injectIntoDevTools({
  bundleType: process.env.NODE_ENV === "production" ? 0 : 1,
  rendererPackageName: "@fcannizzaro/streamdeck-react",
  version: "0.1.0",
});
