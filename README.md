

<p align="center">
  <img src="https://fcannizzaro.com/_astro/streamdeck-react.BAjPov6j.webp" alt="illustration" />
</p>

# @fcannizzaro/streamdeck-react

[![npm](https://img.shields.io/npm/v/@fcannizzaro/streamdeck-react?label=@fcannizzaro/streamdeck-react)](https://www.npmjs.com/package/@fcannizzaro/streamdeck-react)
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
import { createPlugin } from "@fcannizzaro/streamdeck-react";
import { counterAction } from "./actions/counter.tsx";

const plugin = createPlugin({
  fonts: [],
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

- `samples/counter/` - local state, settings hook, dial interaction
- `samples/zustand/` - shared external store across multiple actions
- `samples/jotai/` - shared atom state with a plugin-level wrapper
- `samples/pokemon/` - richer plugin example with custom wrappers

## Documentation

For setup guides, API reference, state-sharing patterns, and more examples, see:

https://streamdeckreact.fcannizzaro.com

## License

MIT
