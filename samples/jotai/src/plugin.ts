import { createPlugin, googleFont } from "@fcannizzaro/streamdeck-react";
import { displayAction } from "./actions/display";
import { incrementAction } from "./actions/increment";
import { resetAction } from "./actions/reset";
import { JotaiWrapper } from "./wrapper";

const inter = await googleFont("Inter");

const plugin = createPlugin({
  fonts: [inter],
  actions: [displayAction, incrementAction, resetAction],
  wrapper: JotaiWrapper,
});

await plugin.connect();
