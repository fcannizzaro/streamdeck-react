import { createPlugin } from "@fcannizzaro/streamdeck-react";
import { springBounceAction } from "./actions/spring-bounce";
import { fadeSlideAction } from "./actions/fade-slide";
import { springDialAction } from "./actions/spring-dial";
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
  actions: [springBounceAction, fadeSlideAction, springDialAction],
});

await plugin.connect();
