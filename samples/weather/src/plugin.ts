// ── Weather Plugin ─────────────────────────────────────────────────
// Entry point for the Stream Deck weather forecast plugin.

import { createPlugin, googleFont } from "@fcannizzaro/streamdeck-react";
import { weatherAction } from "./actions/weather-touchstrip";

// Import store to trigger auto-polling on plugin load
import "./store";

const inter = await googleFont("Inter");

const plugin = createPlugin({
  fonts: [inter],
  devtools: true,
  actions: [weatherAction],
});

await plugin.connect();
