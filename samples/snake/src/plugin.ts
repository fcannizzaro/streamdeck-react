import { createPlugin } from "@fcannizzaro/streamdeck-react";
import { snakeAction } from "./actions/snake";
import InterRegular from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2";

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
  actions: [snakeAction],
});

await plugin.connect();
