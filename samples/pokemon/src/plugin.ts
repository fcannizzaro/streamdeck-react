import { readFile } from "node:fs/promises";
import { createPlugin } from "@fcannizzaro/streamdeck-react";
import { pokemonAction } from "./actions/pokemon";
import { QueryWrapper } from "./wrapper";

const plugin = createPlugin({
  fonts: [
    {
      name: "Inter",
      data: await readFile(
        /* @vite-ignore */
        new URL("../fonts/Inter-Regular.ttf", import.meta.url),
      ),
      weight: 400,
      style: "normal",
    },
  ],
  actions: [pokemonAction],
  wrapper: QueryWrapper,
});

await plugin.connect();
