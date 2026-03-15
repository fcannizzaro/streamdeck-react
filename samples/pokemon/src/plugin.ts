import { createPlugin, googleFont } from "@fcannizzaro/streamdeck-react";
import { pokemonAction } from "./actions/pokemon";
import { QueryWrapper } from "./wrapper";

const inter = await googleFont("Inter");

const plugin = createPlugin({
  fonts: [inter],
  devtools: true,
  actions: [pokemonAction],
  wrapper: QueryWrapper,
});

await plugin.connect();
