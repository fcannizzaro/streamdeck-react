import { createPlugin, googleFont } from "@fcannizzaro/streamdeck-react";
import { springBounceAction } from "./actions/spring-bounce";
import { fadeSlideAction } from "./actions/fade-slide";
import { springDialAction } from "./actions/spring-dial";

const inter = await googleFont("Inter");

const plugin = createPlugin({
  fonts: [inter],
  devtools: true,
  actions: [springBounceAction, fadeSlideAction, springDialAction],
});

await plugin.connect();
