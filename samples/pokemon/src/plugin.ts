import { createPlugin } from "@fcannizzaro/streamdeck-react";
import { pokemonAction } from "./actions/pokemon";
import { QueryWrapper } from "./wrapper";
import InterRegular from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2";

const plugin = createPlugin({
  fonts: [
    {
      name: "Inter",
      data: InterRegular,
      weight: 400,
      style: "normal",
    },
  ],
  actions: [pokemonAction],
  wrapper: QueryWrapper,
});

await plugin.connect();
