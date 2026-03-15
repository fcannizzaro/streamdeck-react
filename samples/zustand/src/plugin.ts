import { createPlugin, googleFont } from "@fcannizzaro/streamdeck-react";
import { displayAction } from "./actions/display";
import { incrementAction } from "./actions/increment";
import { resetAction } from "./actions/reset";

const inter = await googleFont("Inter");

const plugin = createPlugin({
  fonts: [inter],
  devtools: true,
  actions: [displayAction, incrementAction, resetAction],
});

await plugin.connect();
