import { readFile } from "node:fs/promises";
import { createPlugin } from "@fcannizzaro/streamdeck-react";
import { displayAction } from "./actions/display.tsx";
import { incrementAction } from "./actions/increment.tsx";
import { resetAction } from "./actions/reset.tsx";
import { JotaiWrapper } from "./wrapper.tsx";

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
