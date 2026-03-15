import { Renderer } from "@takumi-rs/core";
import type { Renderer as RendererType } from "@takumi-rs/core";
import type { JsonObject } from "@elgato/utils";
import { RootRegistry } from "@/roots/registry";
import type { PluginConfig, Plugin, ActionDefinition, FontConfig, TakumiBackend } from "./types";
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
//   const plugin = createPlugin(config)  ← synchronous, returns Plugin
//     │
//     └─ 1. Resolve adapter (custom or physicalDevice() default)
//
//   await plugin.connect()               ← async, performs initialization
//     │
//     ├─ 2. Resolve Takumi backend ("native-binding" or "wasm")
//     ├─ 3. Initialize the Takumi renderer
//     │     Native: static import (bundler replaces with loader).
//     │     WASM: dynamic import of @takumi-rs/wasm + init().
//     ├─ 4. Create RenderPool (optional worker thread for offloading)
//     │     Workers are force-disabled for WASM mode.
//     ├─ 5. Build RenderConfig (format, DPR, cache budgets, debug flags)
//     ├─ 6. Create RootRegistry (central action→root mapping)
//     ├─ 7. Load initial global settings via adapter
//     ├─ 8. Subscribe to global settings changes via adapter
//     ├─ 9. Register each action definition via adapter callbacks
//     ├─ 10. Enable render metrics (debug mode)
//     ├─ 11. Start devtools server (if configured)
//     ├─ 12. Initialize render worker pool (non-blocking)
//     └─ 13. Connect to the Stream Deck SDK via adapter

export function createPlugin(config: PluginConfig): Plugin {
  // ── Adapter resolution ────────────────────────────────────────
  // Defaults to physicalDevice() which wraps the @elgato/streamdeck
  // SDK.  Custom adapters (web simulator, test harness) can be
  // passed via config.adapter.
  const adapter = config.adapter ?? physicalDevice();

  return {
    async connect(): Promise<void> {
      // ── Takumi backend resolution ─────────────────────────────────
      const takumiMode: TakumiBackend = config.takumi ?? "native-binding";

      // WASM mode: force workers off — WebContainer/browser environments
      // may lack node:worker_threads, and the WASM renderer already runs
      // in the main thread without blocking via its async API.
      const useWorker = takumiMode === "wasm" ? false : config.useWorker !== false;

      // ── Render Pool (optional worker thread) ───────────────────────
      const renderPool = useWorker ? new RenderPool(config.fonts) : null;

      // ── Initialize the Takumi renderer ────────────────────────────
      // Native mode: uses the static import at the top of this module.
      // WASM mode: dynamically imports @takumi-rs/wasm and calls init().
      const renderer = await initializeRenderer(takumiMode, config.fonts);

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

      // Initialize the render worker (non-blocking, falls back to main thread on failure)
      if (renderPool != null) {
        renderPool.initialize().catch(() => {
          // Failure is handled inside RenderPool — it logs a warning and sets failed=true
        });
      }

      // Connect to the Stream Deck SDK
      await adapter.connect();
    },
  };
}

// ── Internal: Initialize Takumi Renderer ────────────────────────────
//
// Creates an initialized Renderer instance from either the native
// binding or the WASM backend.
//
// Native binding (default):
//   Uses the static `import { Renderer } from "@takumi-rs/core"` at
//   the top of this module.  In bundled output, the streamDeckReact()
//   plugin replaces this import with a lightweight virtual loader that
//   uses createRequire(import.meta.url) to load the platform-specific
//   .node binary.  This avoids the Rollup inlineDynamicImports ordering
//   issue where the inlined NAPI-RS loader code would be placed after
//   the entry point's top-level await, leaving the module namespace
//   undefined at access time.
//
// WASM:
//   @takumi-rs/wasm is an optional peer dependency loaded via dynamic
//   import() so it's only resolved when explicitly requested.  The
//   WASM Renderer requires an explicit init() call before use.

async function initializeRenderer(mode: TakumiBackend, fonts: FontConfig[]): Promise<RendererType> {
  const fontData = fonts.map((f) => ({
    name: f.name,
    data: f.data,
    weight: f.weight,
    style: f.style,
  }));

  if (mode === "wasm") {
    const wasm = await import("@takumi-rs/wasm");
    await wasm.default();
    // Cast: @takumi-rs/wasm Renderer has the same render() API surface
    // used by the pipeline, but differs in ancillary methods that the
    // library never calls (purgeResourcesCache, loadFontSync, etc.).
    return new wasm.Renderer({ fonts: fontData }) as unknown as RendererType;
  }

  return new Renderer({ fonts: fontData });
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
