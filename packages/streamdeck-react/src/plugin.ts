import { Renderer } from "@takumi-rs/core";
import type { JsonObject } from "@elgato/utils";
import { RootRegistry } from "@/roots/registry";
import type { PluginConfig, Plugin, ActionDefinition } from "./types";
import type { RenderConfig } from "@/render/pipeline";
import { RenderPool } from "@/render/render-pool";
import { metrics } from "@/render/metrics";
import { startDevtoolsServer } from "./devtools/index.js";
import { physicalDevice } from "@/adapter/physical-device";
import type { StreamDeckAdapter } from "@/adapter/types";

// ── createPlugin ────────────────────────────────────────────────────
//
// Main entry point that wires the entire runtime together.
//
// Initialization sequence:
//
//   createPlugin(config)
//     │
//     ├─ 1. Resolve adapter (custom or physicalDevice() default)
//     ├─ 2. Create Takumi Renderer (native Rust rasterizer) with fonts
//     ├─ 3. Create RenderPool (optional worker thread for offloading)
//     ├─ 4. Build RenderConfig (format, DPR, cache budgets, debug flags)
//     ├─ 5. Create RootRegistry (central action→root mapping)
//     ├─ 6. Load initial global settings via adapter
//     ├─ 7. Subscribe to global settings changes via adapter
//     ├─ 8. Register each action definition via adapter callbacks
//     ├─ 9. Enable render metrics (debug mode)
//     ├─ 10. Start devtools server (if configured)
//     └─ Return { connect() } → starts the adapter connection
//
// The returned Plugin.connect() initializes the worker pool (non-blocking,
// falls back on failure) and connects via the adapter.

export function createPlugin(config: PluginConfig): Plugin {
  // ── Adapter resolution ────────────────────────────────────────
  // Defaults to physicalDevice() which wraps the @elgato/streamdeck
  // SDK.  Custom adapters (web simulator, test harness) can be
  // passed via config.adapter.
  const adapter = config.adapter ?? physicalDevice();

  // Create a shared Takumi Renderer instance with the provided fonts
  const renderer = new Renderer({
    fonts: config.fonts.map((f) => ({
      name: f.name,
      data: f.data,
      weight: f.weight,
      style: f.style,
    })),
  });

  // ── Render Pool (optional worker thread) ───────────────────────
  const renderPool = config.useWorker !== false ? new RenderPool(config.fonts) : null;

  const renderConfig: RenderConfig = {
    renderer,
    imageFormat: config.imageFormat ?? "png",
    caching: config.caching ?? true,
    devicePixelRatio: config.devicePixelRatio ?? 1,
    debug: config.debug ?? process.env.NODE_ENV !== "production",
    imageCacheMaxBytes: config.imageCacheMaxBytes ?? 16 * 1024 * 1024,
    touchStripCacheMaxBytes: config.touchStripCacheMaxBytes ?? 8 * 1024 * 1024,
    renderPool,
  };

  // Create the root registry
  const registry = new RootRegistry(
    renderConfig,
    adapter,
    async (settings: JsonObject) => {
      await adapter.setGlobalSettings(settings);
    },
    config.wrapper,
  );

  // Load initial global settings
  adapter
    .getGlobalSettings()
    .then((gs: JsonObject) => {
      registry.setGlobalSettings(gs);
    })
    .catch((err: unknown) => {
      console.error("[@fcannizzaro/streamdeck-react] Failed to load global settings:", err);
    });

  // Listen for global settings changes
  adapter.onGlobalSettingsChanged((settings: JsonObject) => {
    registry.setGlobalSettings(settings);
  });

  // Register each action definition via the adapter
  for (const definition of config.actions) {
    registerActionWithAdapter(adapter, definition, registry, config.onActionError);
  }

  // ── Metrics (debug mode) ───────────────────────────────────────────
  if (renderConfig.debug) {
    metrics.enable();
  }

  // ── DevTools server (conditional) ──────────────────────────────────────
  if (config.devtools) {
    startDevtoolsServer({
      devtoolsName: adapter.pluginUUID,
      registry,
      renderConfig,
    });
  }

  return {
    async connect() {
      // Initialize the render worker (non-blocking, falls back to main thread on failure)
      if (renderPool != null) {
        renderPool.initialize().catch(() => {
          // Failure is handled inside RenderPool — it logs a warning and sets failed=true
        });
      }
      await adapter.connect();
    },
  };
}

// ── Internal: Register an action definition via the adapter ─────────
//
// Bridges the adapter's callback-based event model to the library's
// registry-based routing system:
//
//   Adapter event (e.g. onKeyDown callback)
//     → registry.dispatch(actionId, "keyDown", payload)
//       → ReactRoot.eventBus.emit("keyDown", payload)
//         → useKeyDown() hook fires in user component
//
// Each callback is wrapped in try/catch with error isolation — a crash
// in one action's handler doesn't affect other actions.  Errors are
// forwarded to the optional onError callback for user-level handling.

function registerActionWithAdapter(
  adapter: StreamDeckAdapter,
  definition: ActionDefinition,
  registry: RootRegistry,
  onError?: (uuid: string, actionId: string, error: Error) => void,
): void {
  const handleError = (actionId: string, err: unknown) => {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error(
      `[@fcannizzaro/streamdeck-react] Error in action ${definition.uuid} (${actionId}):`,
      error,
    );
    onError?.(definition.uuid, actionId, error);
  };

  adapter.registerAction(definition.uuid, {
    onWillAppear(ev) {
      try {
        const controller = ev.payload.controller;
        const isEncoder = controller === "Encoder";

        // Touchstrip path: the registry handles shared TouchStripRoot creation
        if (isEncoder && definition.touchStrip) {
          registry.create(ev, definition.touchStrip, definition);
          return;
        }

        // Pick the appropriate component
        const component = isEncoder ? (definition.dial ?? definition.key) : definition.key;

        if (!component) return;

        registry.create(ev, component, definition);
      } catch (err) {
        handleError(ev.action.id, err);
      }
    },

    onWillDisappear(actionId) {
      try {
        registry.destroy(actionId);
      } catch (err) {
        handleError(actionId, err);
      }
    },

    onKeyDown(actionId, payload) {
      try {
        registry.dispatch(actionId, "keyDown", payload);
      } catch (err) {
        handleError(actionId, err);
      }
    },

    onKeyUp(actionId, payload) {
      try {
        registry.dispatch(actionId, "keyUp", payload);
      } catch (err) {
        handleError(actionId, err);
      }
    },

    onDialRotate(actionId, payload) {
      try {
        registry.dispatch(actionId, "dialRotate", payload);
      } catch (err) {
        handleError(actionId, err);
      }
    },

    onDialDown(actionId, payload) {
      try {
        registry.dispatch(actionId, "dialDown", payload);
      } catch (err) {
        handleError(actionId, err);
      }
    },

    onDialUp(actionId, payload) {
      try {
        registry.dispatch(actionId, "dialUp", payload);
      } catch (err) {
        handleError(actionId, err);
      }
    },

    onTouchTap(actionId, payload) {
      try {
        registry.dispatch(actionId, "touchTap", payload);
      } catch (err) {
        handleError(actionId, err);
      }
    },

    onDidReceiveSettings(actionId, settings) {
      try {
        registry.updateSettings(actionId, settings);
      } catch (err) {
        handleError(actionId, err);
      }
    },

    onSendToPlugin(actionId, payload) {
      try {
        registry.dispatch(actionId, "sendToPlugin", payload);
      } catch (err) {
        handleError(actionId, err);
      }
    },

    onPropertyInspectorDidAppear(actionId) {
      try {
        registry.dispatch(actionId, "propertyInspectorDidAppear", undefined as never);
      } catch (err) {
        handleError(actionId, err);
      }
    },

    onPropertyInspectorDidDisappear(actionId) {
      try {
        registry.dispatch(actionId, "propertyInspectorDidDisappear", undefined as never);
      } catch (err) {
        handleError(actionId, err);
      }
    },

    onTitleParametersDidChange(actionId, payload) {
      try {
        registry.dispatch(actionId, "titleParametersDidChange", payload);
      } catch (err) {
        handleError(actionId, err);
      }
    },
  });
}
