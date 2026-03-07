import type { ComponentType } from "react";
import type {
  Action,
  DialAction,
  KeyAction,
  WillAppearEvent,
  DeviceType,
} from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils"
import { ReactRoot } from "./root";
import type {
  ActionDefinition,
  ActionInfo,
  CanvasInfo,
  DeviceInfo,
  EventMap,
  StreamDeckAccess,
  WrapperComponent,
} from "@/types";
import type { RenderConfig } from "@/render/pipeline";

// ── Device key size lookup ──────────────────────────────────────────

const KEY_SIZES: Record<number, { width: number; height: number }> = {
  0: { width: 72, height: 72 }, // StreamDeck
  1: { width: 80, height: 80 }, // StreamDeckMini
  2: { width: 96, height: 96 }, // StreamDeckXL
  3: { width: 72, height: 72 }, // StreamDeckMobile
  4: { width: 72, height: 72 }, // CorsairGKeys
  5: { width: 72, height: 72 }, // StreamDeckPedal (no display, but default)
  6: { width: 72, height: 72 }, // CorsairVoyager
  7: { width: 144, height: 144 }, // StreamDeckPlus
  8: { width: 72, height: 72 }, // SCUFController
  9: { width: 72, height: 72 }, // StreamDeckNeo
  10: { width: 144, height: 144 }, // StreamDeckStudio
  11: { width: 144, height: 144 }, // VirtualStreamDeck
  12: { width: 144, height: 144 }, // Galleon100SD
  13: { width: 144, height: 144 }, // StreamDeckPlusXL
};

const DIAL_SIZE = { width: 200, height: 100 };
const TOUCH_SIZE = { width: 200, height: 100 };

function getCanvasInfo(
  deviceType: DeviceType,
  surfaceType: "key" | "dial" | "touch",
): CanvasInfo {
  if (surfaceType === "dial") {
    return { ...DIAL_SIZE, type: "dial" };
  }
  if (surfaceType === "touch") {
    return { ...TOUCH_SIZE, type: "touch" };
  }
  const size = KEY_SIZES[deviceType as number] ?? { width: 72, height: 72 };
  return { ...size, type: "key" };
}

// ── Root Registry ───────────────────────────────────────────────────

export class RootRegistry {
  private roots = new Map<string, ReactRoot>();
  private renderConfig: RenderConfig;
  private renderDebounceMs: number;
  private sdkInstance: StreamDeckAccess["sdk"];
  private globalSettings: JsonObject = {};
  private onGlobalSettingsChange: (settings: JsonObject) => Promise<void>;
  private wrapper?: WrapperComponent;

  constructor(
    renderConfig: RenderConfig,
    renderDebounceMs: number,
    sdkInstance: StreamDeckAccess["sdk"],
    onGlobalSettingsChange: (settings: JsonObject) => Promise<void>,
    wrapper?: WrapperComponent,
  ) {
    this.renderConfig = renderConfig;
    this.renderDebounceMs = renderDebounceMs;
    this.sdkInstance = sdkInstance;
    this.onGlobalSettingsChange = onGlobalSettingsChange;
    this.wrapper = wrapper;
  }

  setGlobalSettings(settings: JsonObject): void {
    this.globalSettings = settings;
    // Propagate to all active roots
    for (const root of this.roots.values()) {
      root.updateGlobalSettings(settings);
    }
  }

  // ── Create a React root for an action instance ────────────────

  create(
    ev: WillAppearEvent<JsonObject>,
    component: ComponentType,
    definition: ActionDefinition,
  ): void {
    const contextId = ev.action.id;

    // Don't recreate if already exists
    if (this.roots.has(contextId)) return;

    const device = ev.action.device;
    const controller = ev.action.controllerType;
    const isEncoder = controller === "Encoder";

    // Determine surface type
    let surfaceType: "key" | "dial" | "touch" = "key";
    if (isEncoder && definition.dial) {
      surfaceType = "dial";
    }

    const deviceInfo: DeviceInfo = {
      id: device.id,
      type: device.type,
      size: device.size,
      name: device.name,
    };

    const actionInfo: ActionInfo = {
      id: contextId,
      uuid: definition.uuid,
      controller,
      coordinates: "coordinates" in ev.action
        ? (ev.action as KeyAction).coordinates
        : undefined,
      isInMultiAction: ev.payload.isInMultiAction,
    };

    const canvas = getCanvasInfo(device.type, surfaceType);

    const root = new ReactRoot(
      component,
      actionInfo,
      deviceInfo,
      canvas,
      ev.payload.settings,
      this.globalSettings,
      ev.action as Action | DialAction | KeyAction,
      this.sdkInstance,
      this.renderConfig,
      this.renderDebounceMs,
      // onSettingsChange
      async (settings: JsonObject) => {
        await ev.action.setSettings(settings);
      },
      // onGlobalSettingsChange
      this.onGlobalSettingsChange,
      this.wrapper,
      definition.wrapper,
      definition.dialLayout,
    );

    // Emit willAppear to the newly created root
    root.eventBus.emitSticky("willAppear", {
      settings: ev.payload.settings,
      controller,
      isInMultiAction: ev.payload.isInMultiAction,
    });

    this.roots.set(contextId, root);
  }

  // ── Destroy a React root ──────────────────────────────────────

  destroy(contextId: string): void {
    const root = this.roots.get(contextId);
    if (root) {
      root.unmount();
      this.roots.delete(contextId);
    }
  }

  // ── Dispatch an event to a root ───────────────────────────────

  dispatch<K extends keyof EventMap>(
    contextId: string,
    event: K,
    payload: EventMap[K],
  ): void {
    const root = this.roots.get(contextId);
    if (root) {
      root.eventBus.emit(event, payload);
    }
  }

  // ── Update settings on a specific root ────────────────────────

  updateSettings(contextId: string, settings: JsonObject): void {
    const root = this.roots.get(contextId);
    if (root) {
      root.updateSettings(settings);
    }
  }

  // ── Cleanup all roots ─────────────────────────────────────────

  destroyAll(): void {
    for (const [_, root] of this.roots) {
      root.unmount();
    }
    this.roots.clear();
  }
}
