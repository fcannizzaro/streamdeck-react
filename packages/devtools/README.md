# @fcannizzaro/streamdeck-react-devtools

[![npm](https://img.shields.io/npm/v/@fcannizzaro/streamdeck-react-devtools)](https://www.npmjs.com/package/@fcannizzaro/streamdeck-react-devtools)

Browser-based DevTools for [`@fcannizzaro/streamdeck-react`](https://github.com/fcannizzaro/streamdeck-react) — inspect actions, events, renders, console, and network in real time.

## Install

```bash
npm install -g @fcannizzaro/streamdeck-react-devtools
```

```bash
pnpm add -g @fcannizzaro/streamdeck-react-devtools
```

```bash
bun add -g @fcannizzaro/streamdeck-react-devtools
```

## Usage

```bash
streamdeck-react-devtools
```

This starts a local server and opens the DevTools UI in your browser. Running plugins are discovered automatically via port scanning.

You can optionally specify a port:

```bash
streamdeck-react-devtools 3000
```

## Panels

| Panel        | Description                                       |
| ------------ | ------------------------------------------------- |
| **Console**  | Plugin `console.log`, `warn`, `error` output      |
| **Network**  | Outgoing HTTP requests, responses, and errors      |
| **Elements** | Live React component tree for each action          |
| **Preview**  | Visual preview of rendered keys, dials, and touch bars |
| **Events**   | Stream Deck event bus messages per action           |

## Keyboard Shortcuts

| Shortcut          | Action                 |
| ----------------- | ---------------------- |
| `Ctrl/Cmd + 1–5`  | Toggle panel           |
| `Ctrl/Cmd + K`    | Clear active panel(s)  |

Tabs can be reordered via drag-and-drop. Right-click a tab to switch between horizontal and vertical layout.

## Documentation

https://streamdeckreact.fcannizzaro.com/devtools

## License

MIT
