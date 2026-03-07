import { createPlugin } from "@fcannizzaro/streamdeck-react";
import { displayAction } from "./actions/display";
import { incrementAction } from "./actions/increment";
import { resetAction } from "./actions/reset";
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
  actions: [displayAction, incrementAction, resetAction],
});

await plugin.connect();
