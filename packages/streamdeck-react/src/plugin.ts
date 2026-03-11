import streamDeck, {
  SingletonAction,
  type WillAppearEvent,
  type WillDisappearEvent,
  type KeyDownEvent,
  type KeyUpEvent,
  type DialRotateEvent,
  type DialDownEvent,
  type DialUpEvent,
  type TouchTapEvent,
  type DidReceiveSettingsEvent,
  type SendToPluginEvent,
  type PropertyInspectorDidAppearEvent,
  type PropertyInspectorDidDisappearEvent,
  type TitleParametersDidChangeEvent,
} from "@elgato/streamdeck";
import { Renderer } from "@takumi-rs/core";
import type { JsonObject, JsonValue } from "@elgato/utils";
import { RootRegistry } from "@/roots/registry";
import type { PluginConfig, Plugin, ActionDefinition } from "./types";
import type { RenderConfig } from "@/render/pipeline";
import { RenderPool } from "@/render/render-pool";
import { metrics } from "@/render/metrics";
import { startDevtoolsServer } from "./devtools/index.js";

// ── createPlugin ────────────────────────────────────────────────────
//
// Main entry point that wires the entire runtime together.
//
// Initialization sequence:
//
//   createPlugin(config)
//     │
//     ├─ 1. Create Takumi Renderer (native Rust rasterizer) with fonts
//     ├─ 2. Create RenderPool (optional worker thread for offloading)
//     ├─ 3. Build RenderConfig (format, DPR, cache budgets, debug flags)
//     ├─ 4. Create RootRegistry (central action→root mapping)
//     ├─ 5. Load initial global settings from SDK
//     ├─ 6. Subscribe to global settings changes
//     ├─ 7. Register each action definition as a SingletonAction
//     ├─ 8. Enable render metrics (debug mode)
//     ├─ 9. Start devtools server (if configured)
//     └─ Return { connect() } → starts the SDK connection
//
// The returned Plugin.connect() initializes the worker pool (non-blocking,
// falls back on failure) and connects to the Stream Deck SDK.

export function createPlugin(config: PluginConfig): Plugin {
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
    touchbarCacheMaxBytes: config.touchbarCacheMaxBytes ?? 8 * 1024 * 1024,
    renderPool,
    touchbarImageFormat: config.touchbarImageFormat ?? "webp",
  };

  const renderDebounceMs = config.renderDebounceMs ?? 16;

  // Create the root registry
  const registry = new RootRegistry(
    renderConfig,
    renderDebounceMs,
    streamDeck,
    async (settings: JsonObject) => {
      await streamDeck.settings.setGlobalSettings(settings);
    },
    config.wrapper,
  );

  // Load initial global settings
  streamDeck.settings
    .getGlobalSettings()
    .then((gs) => {
      registry.setGlobalSettings(gs);
    })
    .catch((err) => {
      console.error("[@fcannizzaro/streamdeck-react] Failed to load global settings:", err);
    });

  // Listen for global settings changes
  streamDeck.settings.onDidReceiveGlobalSettings((ev) => {
    registry.setGlobalSettings(ev.settings);
  });

  // Register each action definition
  for (const definition of config.actions) {
    const singletonAction = createSingletonAction(definition, registry, config.onActionError);
    streamDeck.actions.registerAction(singletonAction);
  }

  // ── Metrics (debug mode) ───────────────────────────────────────────
  if (renderConfig.debug) {
    metrics.enable();
  }

  // ── DevTools server (conditional) ──────────────────────────────────────
  if (config.devtools) {
    startDevtoolsServer({
      devtoolsName: streamDeck.info.plugin.uuid,
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
      await streamDeck.connect();
    },
  };
}

// ── Internal: Generate a SingletonAction from an ActionDefinition ───
//
// Creates an anonymous SingletonAction subclass for each action UUID.
// This bridges the Elgato SDK's event-driven model to our React-based
// rendering system:
//
//   Elgato SDK event (e.g. onKeyDown)
//     → SingletonAction handler
//       → registry.dispatch(actionId, "keyDown", payload)
//         → ReactRoot.eventBus.emit("keyDown", payload)
//           → useKeyDown() hook fires in user component
//
// Each handler is wrapped in try/catch with error isolation — a crash
// in one action's handler doesn't affect other actions.  Errors are
// forwarded to the optional onError callback for user-level handling.

function createSingletonAction(
  definition: ActionDefinition,
  registry: RootRegistry,
  onError?: (uuid: string, actionId: string, error: Error) => void,
): SingletonAction<JsonObject> {
  const action = new (class extends SingletonAction<JsonObject> {
    override readonly manifestId = definition.uuid;

    override onWillAppear(ev: WillAppearEvent<JsonObject>) {
      try {
        const controller = ev.payload.controller;
        const isEncoder = controller === "Encoder";

        // Touchbar path: the registry handles shared TouchBarRoot creation
        if (isEncoder && definition.touchBar) {
          registry.create(ev, definition.touchBar, definition);
          return;
        }

        // Pick the appropriate component
        const component = isEncoder ? (definition.dial ?? definition.key) : definition.key;

        if (!component) return;

        registry.create(ev, component, definition);
      } catch (err) {
        this.handleError(ev.action.id, err);
      }
    }

    override onWillDisappear(ev: WillDisappearEvent<JsonObject>) {
      try {
        registry.destroy(ev.action.id);
      } catch (err) {
        this.handleError(ev.action.id, err);
      }
    }

    override onKeyDown(ev: KeyDownEvent<JsonObject>) {
      try {
        registry.dispatch(ev.action.id, "keyDown", {
          settings: ev.payload.settings,
          isInMultiAction: ev.payload.isInMultiAction,
          state: ev.payload.state,
          userDesiredState:
            "userDesiredState" in ev.payload
              ? (ev.payload as { userDesiredState?: number }).userDesiredState
              : undefined,
        });
      } catch (err) {
        this.handleError(ev.action.id, err);
      }
    }

    override onKeyUp(ev: KeyUpEvent<JsonObject>) {
      try {
        registry.dispatch(ev.action.id, "keyUp", {
          settings: ev.payload.settings,
          isInMultiAction: ev.payload.isInMultiAction,
          state: ev.payload.state,
          userDesiredState:
            "userDesiredState" in ev.payload
              ? (ev.payload as { userDesiredState?: number }).userDesiredState
              : undefined,
        });
      } catch (err) {
        this.handleError(ev.action.id, err);
      }
    }

    override onDialRotate(ev: DialRotateEvent<JsonObject>) {
      try {
        registry.dispatch(ev.action.id, "dialRotate", {
          ticks: ev.payload.ticks,
          pressed: ev.payload.pressed,
          settings: ev.payload.settings,
        });
      } catch (err) {
        this.handleError(ev.action.id, err);
      }
    }

    override onDialDown(ev: DialDownEvent<JsonObject>) {
      try {
        registry.dispatch(ev.action.id, "dialDown", {
          settings: ev.payload.settings,
          controller: "Encoder",
        });
      } catch (err) {
        this.handleError(ev.action.id, err);
      }
    }

    override onDialUp(ev: DialUpEvent<JsonObject>) {
      try {
        registry.dispatch(ev.action.id, "dialUp", {
          settings: ev.payload.settings,
          controller: "Encoder",
        });
      } catch (err) {
        this.handleError(ev.action.id, err);
      }
    }

    override onTouchTap(ev: TouchTapEvent<JsonObject>) {
      try {
        registry.dispatch(ev.action.id, "touchTap", {
          tapPos: ev.payload.tapPos,
          hold: ev.payload.hold,
          settings: ev.payload.settings,
        });
      } catch (err) {
        this.handleError(ev.action.id, err);
      }
    }

    override onDidReceiveSettings(ev: DidReceiveSettingsEvent<JsonObject>) {
      try {
        registry.updateSettings(ev.action.id, ev.payload.settings);
      } catch (err) {
        this.handleError(ev.action.id, err);
      }
    }

    override onSendToPlugin(ev: SendToPluginEvent<JsonValue, JsonObject>) {
      try {
        registry.dispatch(ev.action.id, "sendToPlugin", ev.payload);
      } catch (err) {
        this.handleError(ev.action.id, err);
      }
    }

    override onPropertyInspectorDidAppear(ev: PropertyInspectorDidAppearEvent<JsonObject>) {
      try {
        registry.dispatch(ev.action.id, "propertyInspectorDidAppear", undefined as never);
      } catch (err) {
        this.handleError(ev.action.id, err);
      }
    }

    override onPropertyInspectorDidDisappear(ev: PropertyInspectorDidDisappearEvent<JsonObject>) {
      try {
        registry.dispatch(ev.action.id, "propertyInspectorDidDisappear", undefined as never);
      } catch (err) {
        this.handleError(ev.action.id, err);
      }
    }

    override onTitleParametersDidChange(ev: TitleParametersDidChangeEvent<JsonObject>) {
      try {
        registry.dispatch(ev.action.id, "titleParametersDidChange", {
          title: ev.payload.title,
          settings: ev.payload.settings,
        });
      } catch (err) {
        this.handleError(ev.action.id, err);
      }
    }

    private handleError(actionId: string, err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error(
        `[@fcannizzaro/streamdeck-react] Error in action ${definition.uuid} (${actionId}):`,
        error,
      );
      onError?.(definition.uuid, actionId, error);
    }
  })();

  return action;
}
