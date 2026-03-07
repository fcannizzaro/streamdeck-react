import { createPlugin } from "@fcannizzaro/streamdeck-react";
import { counterAction } from "./actions/counter";
import { timerAction } from "./actions/timer";
import { volumeAction } from "./actions/volume";
import { toggleAction } from "./actions/toggle";
import InterRegular from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2"
import SplineSansMono from "@fontsource-variable/spline-sans-mono/files/spline-sans-mono-latin-wght-normal.woff2";

const plugin = createPlugin({
  fonts: [
    {
      name: "Inter",
      data: InterRegular,
      weight: 400,
      style: "normal",
    },
    {
      name: "SplineSansMono",
      data: SplineSansMono,
      weight: 400,
      style: "normal",
    }
  ],
  actions: [counterAction, timerAction, volumeAction, toggleAction],
});

await plugin.connect();
