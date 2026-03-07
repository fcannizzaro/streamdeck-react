import { readFile } from "node:fs/promises";
import { createPlugin } from "@fcannizzaro/streamdeck-react";
import { displayAction } from "./actions/display";
import { incrementAction } from "./actions/increment";
import { resetAction } from "./actions/reset";

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
  actions: [displayAction, incrementAction, resetAction],
});

await plugin.connect();
