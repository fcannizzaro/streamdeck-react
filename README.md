<p align="center">
  <img src="https://fcannizzaro.com/_astro/streamdeck-react.tzWCgEgf.webp" alt="illustration" />
</p>

# @fcannizzaro/streamdeck-react

[![npm](https://img.shields.io/npm/v/@fcannizzaro/streamdeck-react?label=@fcannizzaro/streamdeck-react)](https://www.npmjs.com/package/@fcannizzaro/streamdeck-react)
[![npm](https://img.shields.io/npm/v/@fcannizzaro/streamdeck-react-devtools?label=@fcannizzaro/streamdeck-react-devtools)](https://www.npmjs.com/package/@fcannizzaro/streamdeck-react-devtools)
[![npm](https://img.shields.io/npm/v/create-streamdeck-react?label=create-streamdeck-react)](https://www.npmjs.com/package/create-streamdeck-react)

React primitives, hooks, and a custom renderer for building Stream Deck plugins with React across keys, dials, and touch surfaces.

## Install

```bash
bun add @fcannizzaro/streamdeck-react react
```

## Scaffolding

The fastest way to get started is with the `create-streamdeck-react` CLI:

```bash
bun create streamdeck-react
# or pnpm create streamdeck-react@latest
# or npm create streamdeck-react@latest
```

It walks you through project setup — name, UUID, package manager, starter example — then optionally installs dependencies and links the plugin to Stream Deck.

## Quick Start

Create an action:

```tsx
import { useState } from "react";
import { defineAction, useKeyDown, tw } from "@fcannizzaro/streamdeck-react";

function CounterKey() {
  const [count, setCount] = useState(0);

  useKeyDown(() => {
    setCount((value) => value + 1);
  });

  return (
    <div
      className={tw(
        "flex h-full w-full items-center justify-center bg-gradient-to-br from-[#0f766e] to-[#164e63] text-white",
      )}
    >
      <span className="text-[32px] font-bold">{count}</span>
    </div>
  );
}

export const counterAction = defineAction({
  uuid: "com.example.counter",
  key: CounterKey,
});
```

Register it in your plugin entrypoint:

```ts
import { createPlugin, googleFont } from "@fcannizzaro/streamdeck-react";
import { counterAction } from "./actions/counter.tsx";

const inter = await googleFont("Inter");

const plugin = createPlugin({
  fonts: [inter],
  actions: [counterAction],
});

await plugin.connect();
```

## What You Get

- React-driven rendering for Stream Deck keys, dials, and touch layouts
- Hooks for key, dial, touch, lifecycle, SDK, and settings events
- Optional wrappers for shared providers and external state libraries
- Built-in primitives like `Box`, `Text`, `Image`, `Icon`, `ProgressBar`, and `CircularGauge`

## Samples

- `samples/counter/` — local state, persisted settings, dial interaction
- `samples/zustand/` — shared state across keys via a module-scope Zustand store
- `samples/jotai/` — shared atom state with a plugin-level Jotai Provider wrapper
- `samples/pokemon/` — data fetching with TanStack Query and remote image rendering
- `samples/animation/` — spring bounce, fade-slide, and spring dial animations
- `samples/snake/` — snake game on the Stream Deck+ TouchStrip using dial controls and touch tap
- `samples/weather/` — weather forecast dials with animated detail panels and a shared Zustand store

## DevTools

A browser-based inspector for debugging plugins during development. Enable it in your plugin config:

```ts
const plugin = createPlugin({
  devtools: true,
  // ...
});
```

Then open the hosted UI at [streamdeckreact.fcannizzaro.com/devtools](https://streamdeckreact.fcannizzaro.com/devtools), or run a local copy:

```bash
npx @fcannizzaro/streamdeck-react-devtools
```

Panels include Console, Network, Elements (with on-device highlighting), Preview, and Events. All devtools code is automatically stripped from production builds.

## Documentation

For setup guides, API reference, state-sharing patterns, and more examples, see:

https://streamdeckreact.fcannizzaro.com

## License

MIT
