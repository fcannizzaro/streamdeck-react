// ── Physical Device Adapter ─────────────────────────────────────────
//
// Factory that bridges the @elgato/streamdeck SDK to the
// StreamDeckAdapter interface.  This is the ONLY file in the library
// that value-imports from @elgato/streamdeck — all other modules use
// adapter interfaces exclusively.
//
// The adapter internalizes SingletonAction:
//   registerAction(uuid, callbacks) creates an anonymous SingletonAction
//   subclass, wires its override methods to the provided callbacks, and
//   registers it with the SDK.  The SingletonAction class does not leak
//   beyond this module.
//
// Action wrapping:
//   SDK action objects (Action | DialAction | KeyAction) are converted
//   to AdapterActionHandle via wrapSdkAction().  Methods that are not
//   applicable for the action's surface type (e.g. setImage on a dial)
//   resolve immediately as no-ops, matching the AdapterActionHandle
//   contract.

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
  type Action,
  type DialAction,
  type KeyAction,
} from "@elgato/streamdeck";
import type { JsonObject, JsonValue } from "@elgato/utils";
import type {
  StreamDeckAdapter,
  AdapterActionHandle,
  AdapterActionCallbacks,
  AdapterTriggerDescription,
} from "./types";

// ── Action Wrapping ─────────────────────────────────────────────────
//
// Converts an SDK action (Action | DialAction | KeyAction) into an
// AdapterActionHandle.  Runtime 'in' checks determine which SDK methods
// are available on the concrete action type:
//
//   KeyAction   → has setImage, setTitle, showOk, showAlert, setSettings
//   DialAction  → has setFeedback, setFeedbackLayout, setTriggerDescription, showAlert, setSettings
//   Action      → has showAlert, setSettings
//
// Inapplicable methods resolve immediately (no-op).

function wrapSdkAction(action: Action | DialAction | KeyAction): AdapterActionHandle {
  return {
    id: action.id,
    device: {
      id: action.device.id,
      type: action.device.type as number,
      size: action.device.size,
      name: action.device.name,
    },
    controllerType: action.controllerType,
    coordinates: "coordinates" in action ? (action as KeyAction).coordinates : undefined,

    // ── Key operations ────────────────────────────────────────────
    async setImage(dataUri: string): Promise<void> {
      if ("setImage" in action) {
        await (action as KeyAction).setImage(dataUri);
      }
    },

    async setTitle(title: string): Promise<void> {
      if ("setTitle" in action) {
        await (action as KeyAction).setTitle(title);
      }
    },

    async showOk(): Promise<void> {
      if ("showOk" in action) {
        await (action as KeyAction).showOk();
      }
    },

    // ── Shared operations ─────────────────────────────────────────
    async showAlert(): Promise<void> {
      await action.showAlert();
    },

    async setSettings(settings: JsonObject): Promise<void> {
      await action.setSettings(settings);
    },

    // ── Encoder operations ────────────────────────────────────────
    async setFeedback(payload: Record<string, unknown>): Promise<void> {
      if ("setFeedback" in action) {
        // The SDK's FeedbackPayload type is stricter than our adapter's
        // Record<string, unknown>.  The cast is safe because the library
        // only ever passes well-formed feedback objects (e.g. { canvas: dataUri }).
        await (action as DialAction).setFeedback(payload as never);
      }
    },

    async setFeedbackLayout(layout: string | Record<string, unknown>): Promise<void> {
      if ("setFeedbackLayout" in action) {
        await (
          action as DialAction & {
            setFeedbackLayout(layout: string | Record<string, unknown>): Promise<void>;
          }
        ).setFeedbackLayout(layout);
      }
    },

    async setTriggerDescription(hints: AdapterTriggerDescription): Promise<void> {
      if ("setTriggerDescription" in action) {
        await (action as DialAction).setTriggerDescription({
          rotate: hints.rotate,
          push: hints.push,
          touch: hints.touch,
          longTouch: hints.longTouch,
        });
      }
    },
  };
}

// ── physicalDevice ──────────────────────────────────────────────────
//
// Creates a StreamDeckAdapter that delegates to the @elgato/streamdeck
// SDK singleton.  This is the default adapter used by createPlugin()
// when no custom adapter is provided.
//
// Usage:
//   import { createPlugin, physicalDevice } from "@fcannizzaro/streamdeck-react";
//
//   const plugin = createPlugin({
//     adapter: physicalDevice(),   // explicit, or omit for same default
//     actions: [...],
//     fonts: [...],
//   });

export function physicalDevice(): StreamDeckAdapter {
  return {
    pluginUUID: streamDeck.info.plugin.uuid,

    // ── Connection lifecycle ────────────────────────────────────
    async connect(): Promise<void> {
      await streamDeck.connect();
    },

    // ── Global settings ─────────────────────────────────────────
    async getGlobalSettings<T extends JsonObject = JsonObject>(): Promise<T> {
      return streamDeck.settings.getGlobalSettings<T>();
    },

    async setGlobalSettings<T extends JsonObject = JsonObject>(settings: T): Promise<void> {
      await streamDeck.settings.setGlobalSettings(settings);
    },

    onGlobalSettingsChanged(callback: (settings: JsonObject) => void): void {
      streamDeck.settings.onDidReceiveGlobalSettings((ev) => {
        callback(ev.settings);
      });
    },

    // ── Action registration ─────────────────────────────────────
    //
    // Creates an anonymous SingletonAction subclass that bridges SDK
    // events to the provided callbacks.  Each override extracts the
    // actionId and minimal payload, then delegates to the callback.
    //
    // Error handling within callbacks is the library's responsibility
    // (plugin.ts wraps each callback invocation in try/catch).  The
    // SingletonAction methods themselves should not throw.
    registerAction(uuid: string, callbacks: AdapterActionCallbacks): void {
      const singletonAction = new (class extends SingletonAction<JsonObject> {
        override readonly manifestId = uuid;

        override onWillAppear(ev: WillAppearEvent<JsonObject>): void {
          callbacks.onWillAppear({
            action: wrapSdkAction(ev.action as Action | DialAction | KeyAction),
            payload: {
              settings: ev.payload.settings,
              controller: ev.payload.controller,
              isInMultiAction: ev.payload.isInMultiAction,
            },
          });
        }

        override onWillDisappear(ev: WillDisappearEvent<JsonObject>): void {
          callbacks.onWillDisappear(ev.action.id);
        }

        override onKeyDown(ev: KeyDownEvent<JsonObject>): void {
          callbacks.onKeyDown(ev.action.id, {
            settings: ev.payload.settings,
            isInMultiAction: ev.payload.isInMultiAction,
            state: ev.payload.state,
            userDesiredState:
              "userDesiredState" in ev.payload
                ? (ev.payload as { userDesiredState?: number }).userDesiredState
                : undefined,
          });
        }

        override onKeyUp(ev: KeyUpEvent<JsonObject>): void {
          callbacks.onKeyUp(ev.action.id, {
            settings: ev.payload.settings,
            isInMultiAction: ev.payload.isInMultiAction,
            state: ev.payload.state,
            userDesiredState:
              "userDesiredState" in ev.payload
                ? (ev.payload as { userDesiredState?: number }).userDesiredState
                : undefined,
          });
        }

        override onDialRotate(ev: DialRotateEvent<JsonObject>): void {
          callbacks.onDialRotate(ev.action.id, {
            ticks: ev.payload.ticks,
            pressed: ev.payload.pressed,
            settings: ev.payload.settings,
          });
        }

        override onDialDown(ev: DialDownEvent<JsonObject>): void {
          callbacks.onDialDown(ev.action.id, {
            settings: ev.payload.settings,
            controller: "Encoder",
          });
        }

        override onDialUp(ev: DialUpEvent<JsonObject>): void {
          callbacks.onDialUp(ev.action.id, {
            settings: ev.payload.settings,
            controller: "Encoder",
          });
        }

        override onTouchTap(ev: TouchTapEvent<JsonObject>): void {
          callbacks.onTouchTap(ev.action.id, {
            tapPos: ev.payload.tapPos,
            hold: ev.payload.hold,
            settings: ev.payload.settings,
          });
        }

        override onDidReceiveSettings(ev: DidReceiveSettingsEvent<JsonObject>): void {
          callbacks.onDidReceiveSettings(ev.action.id, ev.payload.settings);
        }

        override onSendToPlugin(ev: SendToPluginEvent<JsonValue, JsonObject>): void {
          callbacks.onSendToPlugin(ev.action.id, ev.payload);
        }

        override onPropertyInspectorDidAppear(
          ev: PropertyInspectorDidAppearEvent<JsonObject>,
        ): void {
          callbacks.onPropertyInspectorDidAppear(ev.action.id);
        }

        override onPropertyInspectorDidDisappear(
          ev: PropertyInspectorDidDisappearEvent<JsonObject>,
        ): void {
          callbacks.onPropertyInspectorDidDisappear(ev.action.id);
        }

        override onTitleParametersDidChange(
          ev: TitleParametersDidChangeEvent<JsonObject>,
        ): void {
          callbacks.onTitleParametersDidChange(ev.action.id, {
            title: ev.payload.title,
            settings: ev.payload.settings,
          });
        }
      })();

      streamDeck.actions.registerAction(singletonAction);
    },

    // ── SDK utilities ───────────────────────────────────────────
    async openUrl(url: string): Promise<void> {
      await streamDeck.system.openUrl(url);
    },

    async switchToProfile(deviceId: string, profile: string): Promise<void> {
      await streamDeck.profiles.switchToProfile(deviceId, profile);
    },

    async sendToPropertyInspector(payload: JsonValue): Promise<void> {
      await streamDeck.ui.sendToPropertyInspector(payload);
    },
  };
}
