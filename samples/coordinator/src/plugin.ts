import { createPlugin, googleFont } from "@fcannizzaro/streamdeck-react";
import { toggleAction } from "./actions/selector";
import { shapeDialAction } from "./actions/control-dial";

const inter = await googleFont("Inter");

const plugin = createPlugin({
  fonts: [inter],
  devtools: true,
  coordinator: true,
  actions: [toggleAction, shapeDialAction],
});

await plugin.connect();
