// ── Weather Plugin ─────────────────────────────────────────────────
// Entry point for the Stream Deck weather forecast plugin.

import { createPlugin } from "@fcannizzaro/streamdeck-react";
import { weatherAction } from "./actions/weather-touchbar";
import InterRegular from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2";

// Import store to trigger auto-polling on plugin load
import "./store";

const plugin = createPlugin({
  fonts: [
    {
      name: "Inter",
      data: InterRegular,
      weight: 400,
      style: "normal",
    },
  ],
  devtools: true,
  actions: [weatherAction],
});

await plugin.connect();
