import { readFile } from "node:fs/promises";
import { createPlugin } from "@fcannizzaro/streamdeck-react";
import { displayAction } from "./actions/display";
import { incrementAction } from "./actions/increment";
import { resetAction } from "./actions/reset";
import { JotaiWrapper } from "./wrapper";

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
  wrapper: JotaiWrapper,
});

await plugin.connect();
