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
import { ActionCoordinator } from "@/coordinator/index";
import type { ThemeDefinition } from "@/theme/index";

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
//     ├─ 3. Auto-detect worker need (touchStrip present → worker on)
//     ├─ 4. Create RenderPool shell (worker thread NOT spawned yet)
//     ├─ 5. Create lazy renderer getter (native: deferred, wasm: eager)
//     │     Native binding: NO initialization here — deferred to first
//     │     render request to save ~12-18 MB at startup.
//     │     WASM: must init eagerly (async init() required).
//     ├─ 6. Build RenderConfig (format, DPR, cache budgets, debug flags)
//     ├─ 7. Create RootRegistry (central action→root mapping)
//     ├─ 8. Load initial global settings via adapter
//     ├─ 9. Subscribe to global settings changes via adapter
//     ├─ 10. Register each action definition via adapter callbacks
//     ├─ 11. Enable render metrics (debug mode)
//     ├─ 12. Start devtools server (if configured)
//     └─ 13. Connect to the Stream Deck SDK via adapter
//
// Memory optimization: lazy initialization
//
//   Previously, connect() eagerly initialized the Takumi renderer
//   (~12-18 MB) and spawned the worker thread (another ~12-18 MB).
//   With lazy init, both are deferred until the first onWillAppear
//   event triggers a render.  A plugin at idle uses ~20-30 MB less.
//
//   Additionally, the worker is now auto-disabled for plugins that
//   don't use touchStrip (unless explicitly enabled via useWorker),
//   saving another ~12-18 MB for simple key-only plugins.

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
      //
      // Auto-detect: when useWorker is not explicitly set, enable the
      // worker thread only when at least one action defines a touchStrip
      // component.  Simple key-only plugins don't benefit from worker
      // offloading (5-15ms main-thread renders are fine at 17ms debounce)
      // but pay ~12-18 MB for the second Takumi instance in the worker.
      const hasTouchStrip = config.actions.some((a) => a.touchStrip != null);
      const useWorker = takumiMode === "wasm" ? false : (config.useWorker ?? hasTouchStrip);

      // ── Render Pool (optional worker thread) ───────────────────────
      const renderPool = useWorker ? new RenderPool(config.fonts) : null;

      // ── Lazy Renderer (deferred initialization) ────────────────────
      // The Takumi native renderer is expensive to initialize (~12-18 MB
      // for the Rust addon + font database).  Instead of creating it
      // eagerly during connect(), we wrap it in a lazy getter that
      // defers initialization until the first actual render request.
      // This means plugins that connect but haven't received an
      // onWillAppear event yet use ~20-30 MB less memory.
      let cachedRenderer: RendererType | null = null;
      const getRenderer = (): RendererType => {
        if (cachedRenderer == null) {
          cachedRenderer = createRendererSync(config.fonts);
          // The native Takumi renderer now owns the font data internally.
          // Release the JS-side ArrayBuffer references to free ~0.5-2 MB
          // of duplicate memory.  This is safe because:
          //   1. The renderer has already copied font data into its Rust heap
          //   2. The RenderPool (if any) has its own SharedArrayBuffer copies
          //   3. No other code path reads config.fonts[].data after this point
          releaseFontData(config.fonts);
        }
        return cachedRenderer;
      };

      // ── Async Renderer Init (WASM only) ───────────────────────────
      // WASM mode requires an async init() call, so we pre-initialize
      // it during connect() — lazy sync init isn't possible for WASM.
      if (takumiMode === "wasm") {
        cachedRenderer = await initializeWasmRenderer(config.fonts);
        releaseFontData(config.fonts);
      }

      const renderConfig: RenderConfig = {
        getRenderer,
        imageFormat: config.imageFormat ?? "png",
        caching: config.caching ?? true,
        devicePixelRatio: config.devicePixelRatio ?? 1,
        debug: config.debug ?? process.env.NODE_ENV !== "production",
        imageCacheMaxBytes: config.imageCacheMaxBytes ?? 16 * 1024 * 1024,
        touchStripCacheMaxBytes: config.touchStripCacheMaxBytes ?? 8 * 1024 * 1024,
        renderPool,
        stylesheets: config.stylesheets,
      };

      // ── Action Coordinator (opt-in) ────────────────────────────────
      // When enabled, creates a plugin-level coordinator that tracks
      // action presence and provides named channels for cross-action
      // state sharing.  Passed to the RootRegistry which injects it
      // into every React root's provider tree.
      const coordinator = config.coordinator ? new ActionCoordinator() : null;

      // ── Theme resolution ──────────────────────────────────────────
      // The theme is passed through to every root's provider tree,
      // where it's injected as CSS custom properties on a wrapper div.
      const theme: ThemeDefinition | null = config.theme ?? null;

      // Create the root registry
      const registry = new RootRegistry(
        renderConfig,
        adapter,
        async (settings: JsonObject) => {
          await adapter.setGlobalSettings(settings);
          // The Elgato SDK does not fire onDidReceiveGlobalSettings back
          // to the plugin that called setGlobalSettings — only external
          // changes (Property Inspector, etc.) trigger that event.
          // Propagate through the registry so ALL roots receive the update.
          // Safe: shallowEqual guards in both registry and each root
          // prevent double-renders on the originating root.
          registry.setGlobalSettings(settings);
        },
        config.wrapper,
        coordinator,
        theme,
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

      // ── Worker pool (deferred initialization) ─────────────────────────
      // The render pool is created here but NOT initialized yet.  Its
      // worker thread will spin up lazily on the first render() call.
      // This defers ~12-18 MB of memory (second Takumi native addon +
      // font database) until a key/dial actually needs to render.
      // Previously, renderPool.initialize() was called here eagerly.

      // Connect to the Stream Deck SDK
      await adapter.connect();
    },
  };
}

// ── Internal: Lazy Renderer Factories ───────────────────────────────
//
// Split into two functions by backend:
//
//   createRendererSync()   — native binding (synchronous)
//     The `import { Renderer } from "@takumi-rs/core"` at the top of
//     this module is statically resolved by the bundler at build time.
//     Construction is synchronous: `new Renderer({ fonts })` loads the
//     platform-specific .node binary and builds the font database.
//     Called lazily by getRenderer() on the first actual render request,
//     deferring ~12-18 MB of memory allocation until an action appears.
//
//   initializeWasmRenderer()  — WASM (async, called eagerly)
//     @takumi-rs/wasm requires an async `init()` call before the
//     Renderer can be constructed, so lazy sync init isn't possible.
//     This function is called once during connect() for WASM mode.
//
// Font data mapping is shared between both paths.

function mapFontData(fonts: FontConfig[]) {
  return fonts.map((f) => ({
    name: f.name,
    data: f.data,
    weight: f.weight,
    style: f.style,
  }));
}

function createRendererSync(fonts: FontConfig[]): RendererType {
  return new Renderer({ fonts: mapFontData(fonts) });
}

async function initializeWasmRenderer(fonts: FontConfig[]): Promise<RendererType> {
  const wasm = await import("@takumi-rs/wasm");
  await wasm.default();
  // Cast: @takumi-rs/wasm Renderer has the same render() API surface
  // used by the pipeline, but differs in ancillary methods that the
  // library never calls (purgeResourcesCache, loadFontSync, etc.).
  return new wasm.Renderer({ fonts: mapFontData(fonts) }) as unknown as RendererType;
}

// ── Internal: Release font ArrayBuffer references ───────────────────
//
// After the Takumi renderer (native or WASM) has consumed font data,
// the JS-side ArrayBuffer/Buffer references are redundant — the native
// code owns its own copy in the Rust/WASM heap.  Nulling out the `data`
// field allows V8 to GC the JS-side buffers (~0.5-2 MB depending on
// number and size of fonts).
//
// The RenderPool (if any) has already converted fonts to
// SharedArrayBuffer in its constructor, so it doesn't reference
// config.fonts[].data anymore.

function releaseFontData(fonts: FontConfig[]): void {
  for (const font of fonts) {
    (font as unknown as { data: null }).data = null;
  }
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
