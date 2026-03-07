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
import { TouchBarRoot } from "./touchbar-root";
import type {
  ActionDefinition,
  ActionInfo,
  CanvasInfo,
  DeviceInfo,
  DialRotatePayload,
  EventMap,
  StreamDeckAccess,
  TouchTapPayload,
  WrapperComponent,
} from "@/types";
import type { RenderConfig } from "@/render/pipeline";

// ── Constants ───────────────────────────────────────────────────────

const SEGMENT_WIDTH = 200;

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
  private touchBarRoots = new Map<string, TouchBarRoot>(); // deviceId → TouchBarRoot
  private touchBarActions = new Map<string, string>(); // actionId → deviceId
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
    // Propagate to all touchbar roots
    for (const tbRoot of this.touchBarRoots.values()) {
      tbRoot.updateGlobalSettings(settings);
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
    if (this.roots.has(contextId) || this.touchBarActions.has(contextId)) return;

    const device = ev.action.device;
    const controller = ev.action.controllerType;
    const isEncoder = controller === "Encoder";

    // ── Touchbar path ───────────────────────────────────────────
    if (isEncoder && definition.touchBar) {
      this.registerTouchBarColumn(ev, definition);
      return;
    }

    // ── Standard per-action root path ───────────────────────────

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

  // ── Register an encoder column with the shared TouchBarRoot ───

  private registerTouchBarColumn(
    ev: WillAppearEvent<JsonObject>,
    definition: ActionDefinition,
  ): void {
    const actionId = ev.action.id;
    const device = ev.action.device;
    const deviceId = device.id;

    // Determine encoder column from coordinates
    const column = this.getEncoderColumn(ev);
    if (column === undefined) {
      console.warn(
        "[@fcannizzaro/streamdeck-react] Cannot determine encoder column for touchbar action:",
        actionId,
      );
      return;
    }

    // Find or create the TouchBarRoot for this device
    let tbRoot = this.touchBarRoots.get(deviceId);
    if (!tbRoot) {
      const deviceInfo: DeviceInfo = {
        id: deviceId,
        type: device.type,
        size: device.size,
        name: device.name,
      };

      tbRoot = new TouchBarRoot(
        definition.touchBar!,
        deviceInfo,
        this.globalSettings,
        this.renderConfig,
        this.renderDebounceMs,
        this.onGlobalSettingsChange,
        this.wrapper,
        definition.touchBarFPS,
      );

      this.touchBarRoots.set(deviceId, tbRoot);
    }

    // Register this column
    tbRoot.addColumn(column, actionId, ev.action as DialAction);

    // Track reverse mapping for event routing
    this.touchBarActions.set(actionId, deviceId);
  }

  private getEncoderColumn(ev: WillAppearEvent<JsonObject>): number | undefined {
    const action = ev.action as unknown as { coordinates?: { column: number } };
    return action.coordinates?.column;
  }

  // ── Destroy a React root ──────────────────────────────────────

  destroy(contextId: string): void {
    // ── Check if this is a touchbar action ──
    const deviceId = this.touchBarActions.get(contextId);
    if (deviceId) {
      const tbRoot = this.touchBarRoots.get(deviceId);
      if (tbRoot) {
        const column = tbRoot.findColumnByActionId(contextId);
        if (column !== undefined) {
          tbRoot.removeColumn(column);
        }
        // Clean up the TouchBarRoot if no columns remain
        if (tbRoot.isEmpty) {
          tbRoot.unmount();
          this.touchBarRoots.delete(deviceId);
        }
      }
      this.touchBarActions.delete(contextId);
      return;
    }

    // ── Standard per-action root path ──
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
    // ── Try per-action root first ──
    const root = this.roots.get(contextId);
    if (root) {
      root.eventBus.emit(event, payload);
      return;
    }

    // ── Try touchbar root ──
    const deviceId = this.touchBarActions.get(contextId);
    if (deviceId) {
      const tbRoot = this.touchBarRoots.get(deviceId);
      if (tbRoot) {
        this.dispatchToTouchBar(tbRoot, contextId, event, payload);
      }
    }
  }

  private dispatchToTouchBar<K extends keyof EventMap>(
    tbRoot: TouchBarRoot,
    actionId: string,
    event: K,
    payload: EventMap[K],
  ): void {
    const column = tbRoot.findColumnByActionId(actionId);
    if (column === undefined) return;

    switch (event) {
      case "touchTap": {
        const tp = payload as unknown as TouchTapPayload;
        tbRoot.eventBus.emit("touchBarTap", {
          tapPos: [column * SEGMENT_WIDTH + tp.tapPos[0], tp.tapPos[1]],
          hold: tp.hold,
          column,
        });
        break;
      }
      case "dialRotate": {
        const dr = payload as unknown as DialRotatePayload;
        tbRoot.eventBus.emit("touchBarDialRotate", {
          column,
          ticks: dr.ticks,
          pressed: dr.pressed,
        });
        break;
      }
      case "dialDown": {
        tbRoot.eventBus.emit("touchBarDialDown", { column });
        break;
      }
      case "dialUp": {
        tbRoot.eventBus.emit("touchBarDialUp", { column });
        break;
      }
      // Other events (keyDown, sendToPlugin, etc.) are not relevant to touchbar
    }
  }

  // ── Update settings on a specific root ────────────────────────

  updateSettings(contextId: string, settings: JsonObject): void {
    const root = this.roots.get(contextId);
    if (root) {
      root.updateSettings(settings);
    }
    // Note: touchbar roots do not have per-action settings.
    // Per-encoder settings can be added in a future enhancement.
  }

  // ── Cleanup all roots ─────────────────────────────────────────

  destroyAll(): void {
    for (const [_, root] of this.roots) {
      root.unmount();
    }
    this.roots.clear();

    for (const [_, tbRoot] of this.touchBarRoots) {
      tbRoot.unmount();
    }
    this.touchBarRoots.clear();
    this.touchBarActions.clear();
  }
}
