import { createPlugin } from "@fcannizzaro/streamdeck-react";
import { snakeTouchbarAction } from "./actions/snake";
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
  actions: [snakeTouchbarAction],
});

await plugin.connect();
