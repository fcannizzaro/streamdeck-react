import { createPlugin, googleFont } from "@fcannizzaro/streamdeck-react";
import { counterAction } from "./actions/counter";
import { timerAction } from "./actions/timer";
import { volumeAction } from "./actions/volume";
import { toggleAction } from "./actions/toggle";
import { equalizerAction } from "./actions/equalizer";
import { globalSettingsKey } from "./actions/global-settings";

const [inter, splineSansMono] = await Promise.all([
  googleFont("Inter"),
  googleFont("Spline Sans Mono"),
]);

const plugin = createPlugin({
  fonts: [inter, splineSansMono],
  devtools: true,
  actions: [counterAction, globalSettingsKey, timerAction, volumeAction, toggleAction, equalizerAction],
});

await plugin.connect();
