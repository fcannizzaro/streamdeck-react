import { createPlugin, googleFont } from "@fcannizzaro/streamdeck-react";
import stylesheet from "./theme.css?inline";
import { counterAction } from "./actions/counter";
import { timerAction } from "./actions/timer";
import { volumeAction } from "./actions/volume";
import { toggleAction } from "./actions/toggle";
import { equalizerAction } from "./actions/equalizer";
import { globalSettingsKey } from "./actions/global-settings";
import { nativeWindowAction } from "./actions/native-window";
import { themedAction } from "./actions/themed";

const [inter, splineSansMono] = await Promise.all([
  googleFont("Inter"),
  googleFont("Spline Sans Mono"),
]);

const plugin = createPlugin({
  fonts: [inter, splineSansMono],
  devtools: true,
  stylesheets: [stylesheet],
  actions: [
    counterAction,
    globalSettingsKey,
    nativeWindowAction,
    timerAction,
    toggleAction,
    volumeAction,
    equalizerAction,
    themedAction,
  ],
});

await plugin.connect();
