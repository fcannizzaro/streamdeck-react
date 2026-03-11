import type { RootRegistry } from "@/roots/registry";
import type { RenderConfig } from "@/render/pipeline";
import { EventBus } from "@/context/event-bus";
import { DevtoolsBridge } from "./bridge";
import { DevtoolsServer, hashToPort } from "./server";
import { patchConsole } from "./intercepts/console";
import { patchFetch } from "./intercepts/fetch";

// ── Start DevTools Server ──────────────────────────────────────────────
//
// Called from plugin.ts when devtools: true.  Wires all data sources
// into the SSE transport in 7 steps:
//
//   1. Create HTTP+SSE server + bridge
//   2. Attach bridge as registry observer (lifecycle/dispatch events)
//   3. Hook into render pipeline (onRender callback)
//   4. Install static EventBus observer (bus-level events)
//   5. Patch console.log/warn/error/info/debug
//   6. Patch globalThis.fetch
//   7. Start listening (async, fire-and-forget)
//
// server.start() is not awaited — the plugin continues connecting to
// the SDK while the HTTP server binds.  If port binding fails, devtools
// simply won't be available (no impact on plugin functionality).
//
// Cleanup: process "exit" handler restores console, fetch, and
// disconnects all hooks to prevent post-exit errors.

export function startDevtoolsServer(config: {
  devtoolsName: string;
  registry: RootRegistry;
  renderConfig: RenderConfig;
}): void {
  const port = hashToPort(config.devtoolsName);

  // 1. Create server + bridge
  const server = new DevtoolsServer(port, config.devtoolsName);
  const bridge = new DevtoolsBridge(server, config.devtoolsName, config.renderConfig);

  // 2. Attach observer to registry
  config.registry.observer = bridge;

  // 3. Attach render hook
  config.renderConfig.onRender = (container, dataUri) => {
    bridge.onRender(container, dataUri);
  };

  // 4. Attach EventBus static observer
  EventBus.devtoolsObserver = (bus, event, payload) => {
    bridge.onEventBusEmit(bus, event, payload);
  };

  // 5. Install intercepts
  const restoreConsole = patchConsole((level, args, stack) => {
    bridge.onConsole(level, args, stack);
  });
  const restoreFetch = patchFetch({
    onRequest: (id, method, url, headers, body) =>
      bridge.onFetchRequest(id, method, url, headers, body),
    onResponse: (id, status, statusText, headers, body, dur) =>
      bridge.onFetchResponse(id, status, statusText, headers, body, dur),
    onError: (id, error, dur) => bridge.onFetchError(id, error, dur),
  });

  // 6. Start listening (async, but we don't await — fire and forget)
  server.start();

  // 7. Register cleanup
  process.on("exit", () => {
    restoreConsole();
    restoreFetch();
    EventBus.devtoolsObserver = null;
    config.registry.observer = null;
    config.renderConfig.onRender = undefined;
    server.stop();
  });
}
