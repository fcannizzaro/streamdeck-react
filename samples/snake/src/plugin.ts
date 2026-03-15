import { createPlugin, googleFont } from "@fcannizzaro/streamdeck-react";
import { snakeAction } from "./actions/snake";

const inter = await googleFont("Inter");

const plugin = createPlugin({
  fonts: [inter],
  devtools: true,
  actions: [snakeAction],
});

await plugin.connect();
