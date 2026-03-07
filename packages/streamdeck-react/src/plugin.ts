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
import type { JsonObject, JsonValue } from "@elgato/utils"
import { RootRegistry } from "@/roots/registry";
import type {
  PluginConfig,
  Plugin,
  ActionDefinition,
} from "./types";
import type { RenderConfig } from "@/render/pipeline";

// ── createPlugin ────────────────────────────────────────────────────

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

  const renderConfig: RenderConfig = {
    renderer,
    imageFormat: config.imageFormat ?? "png",
    caching: config.caching ?? true,
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
      console.error(
        "[@fcannizzaro/streamdeck-react] Failed to load global settings:",
        err,
      );
    });

  // Listen for global settings changes
  streamDeck.settings.onDidReceiveGlobalSettings((ev) => {
    registry.setGlobalSettings(ev.settings);
  });

  // Register each action definition
  for (const definition of config.actions) {
    const singletonAction = createSingletonAction(
      definition,
      registry,
      config.onActionError,
    );
    streamDeck.actions.registerAction(singletonAction);
  }

  return {
    async connect() {
      await streamDeck.connect();
    },
  };
}

// ── Internal: Generate a SingletonAction from an ActionDefinition ───

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

        // Pick the appropriate component
        const component = isEncoder
          ? definition.dial ?? definition.key
          : definition.key;

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

    override onPropertyInspectorDidAppear(
      ev: PropertyInspectorDidAppearEvent<JsonObject>,
    ) {
      try {
        registry.dispatch(
          ev.action.id,
          "propertyInspectorDidAppear",
          undefined as never,
        );
      } catch (err) {
        this.handleError(ev.action.id, err);
      }
    }

    override onPropertyInspectorDidDisappear(
      ev: PropertyInspectorDidDisappearEvent<JsonObject>,
    ) {
      try {
        registry.dispatch(
          ev.action.id,
          "propertyInspectorDidDisappear",
          undefined as never,
        );
      } catch (err) {
        this.handleError(ev.action.id, err);
      }
    }

    override onTitleParametersDidChange(
      ev: TitleParametersDidChangeEvent<JsonObject>,
    ) {
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
