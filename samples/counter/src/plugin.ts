import { readFile } from "node:fs/promises";
import { createPlugin } from "@fcannizzaro/streamdeck-react";
import { counterAction } from "./actions/counter";
import { timerAction } from "./actions/timer";
import { volumeAction } from "./actions/volume";
import { toggleAction } from "./actions/toggle";

const plugin = createPlugin({
  fonts: [
    {
      name: "Inter",
      data: await readFile(
        new URL("../fonts/Inter-Regular.ttf", import.meta.url),
      ),
      weight: 400,
      style: "normal",
    },
  ],
  actions: [counterAction, timerAction, volumeAction, toggleAction],
});

await plugin.connect();
