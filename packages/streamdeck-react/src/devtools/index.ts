import type { RootRegistry } from "@/roots/registry";
import type { RenderConfig } from "@/render/pipeline";
import { EventBus } from "@/context/event-bus";
import { DevtoolsBridge } from "./bridge";
import { DevtoolsServer } from "./server";
import { patchConsole } from "./intercepts/console";
import { patchFetch } from "./intercepts/fetch";

// ── Start DevTools Server ──────────────────────────────────────────────
// Called from plugin.ts when devtools: true. Creates a WebSocket server
// using the `ws` package (static import, externalized by Vite build).

const DEFAULT_PORT = 39400;

export function startDevtoolsServer(config: {
  port?: number;
  devtoolsName: string;
  registry: RootRegistry;
  renderConfig: RenderConfig;
}): void {
  const port = config.port ?? DEFAULT_PORT;

  // 1. Create server + bridge
  const server = new DevtoolsServer(port);
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
