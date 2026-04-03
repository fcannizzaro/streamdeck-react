import type { ComponentType } from "react";
import type { JsonObject } from "@elgato/utils";
import type { AdapterWillAppearEvent, StreamDeckAdapter } from "@/adapter/types";
import { ReactRoot } from "./root";
import { TouchStripRoot } from "./touchstrip-root";
import { shallowEqualSettings } from "./settings-equality";
import { FlushCoordinator } from "./flush-coordinator";
import { RootRecyclingPool, makePoolKey } from "./recycling-pool";
import type {
  ActionDefinition,
  ActionInfo,
  CanvasInfo,
  DeviceInfo,
  DialRotatePayload,
  EventMap,
  TouchTapPayload,
  WrapperComponent,
} from "@/types";
import type { RenderConfig } from "@/render/pipeline";
import type { RegistryObserver } from "@/devtools/observers/lifecycle";

// ── Constants ───────────────────────────────────────────────────────
// Each encoder segment on the touch strip is 200px wide.
// Used for coordinate remapping when routing touch events.

const SEGMENT_WIDTH = 200;

// ── Device key size lookup ──────────────────────────────────────────
// All key surfaces use a unified 144×144 CSS layout viewport.
//
// Why 144:
//   Native resolution of the most common modern devices (SD+, Studio,
//   PlusXL) and exactly 2× the original Stream Deck resolution (72).
//   Normalizing all devices to a single viewport means content designed
//   with explicit pixel sizes (e.g. text-[30px]) looks identical on
//   every device.  The Elgato SDK's setImage() accepts images of any
//   size and downscales to the hardware's native resolution (72, 80,
//   96, or 144), so pushing a 144×144 PNG to a 72×72 key is safe and
//   actually produces better anti-aliasing.
//
// Dial size (200×100) is constant across all encoder-capable devices.

const KEY_SIZES: Record<number, { width: number; height: number }> = {
  0: { width: 144, height: 144 }, // StreamDeck (MK2)
  1: { width: 144, height: 144 }, // StreamDeckMini
  2: { width: 144, height: 144 }, // StreamDeckXL
  3: { width: 144, height: 144 }, // StreamDeckMobile
  4: { width: 144, height: 144 }, // CorsairGKeys
  5: { width: 144, height: 144 }, // StreamDeckPedal (no display, but default)
  6: { width: 144, height: 144 }, // CorsairVoyager
  7: { width: 144, height: 144 }, // StreamDeckPlus
  8: { width: 144, height: 144 }, // SCUFController
  9: { width: 144, height: 144 }, // StreamDeckNeo
  10: { width: 144, height: 144 }, // StreamDeckStudio
  11: { width: 144, height: 144 }, // VirtualStreamDeck
  12: { width: 144, height: 144 }, // Galleon100SD
  13: { width: 144, height: 144 }, // StreamDeckPlusXL
};

const DIAL_SIZE = { width: 200, height: 100 };

function getCanvasInfo(deviceType: number, surfaceType: "key" | "dial"): CanvasInfo {
  if (surfaceType === "dial") {
    return { ...DIAL_SIZE, type: "dial" };
  }
  const size = KEY_SIZES[deviceType as number] ?? { width: 144, height: 144 };
  return { ...size, type: "key" };
}

// ── Root Registry ───────────────────────────────────────────────────
//
// Central hub that maps Stream Deck action instances to React roots
// and routes SDK events to the correct root.
//
//   SDK Event (onKeyDown, onWillAppear, etc.)
//     ↓
//   plugin.ts → SingletonAction handler
//     ↓
//   registry.dispatch(actionId, event, payload)
//     ↓
//   ┌─ Per-action ReactRoot?  → root.eventBus.emit(event, payload)
//   └─ TouchStrip action?       → dispatchToTouchStrip() with coordinate remap
//
// Owns three Maps:
//   roots:           actionId → ReactRoot (per-key/dial instances)
//   touchStripRoots:   deviceId → TouchStripRoot (shared per-device)
//   touchStripActions: actionId → deviceId (reverse lookup for routing)
//
// The observer (RegistryObserver) is set by the devtools system when
// devtools mode is enabled, providing lifecycle and event visibility.

export class RootRegistry {
  private roots = new Map<string, ReactRoot>();
  private touchStripRoots = new Map<string, TouchStripRoot>(); // deviceId → TouchStripRoot
  private touchStripActions = new Map<string, string>(); // actionId → deviceId
  private renderConfig: RenderConfig;
  private adapter: StreamDeckAdapter;
  private globalSettings: JsonObject = {};
  private onGlobalSettingsChange: (settings: JsonObject) => Promise<void>;
  private wrapper?: WrapperComponent;

  /** Coordinated flush scheduler. Batches and priority-orders flushes across all roots. */
  readonly flushCoordinator: FlushCoordinator;

  /** Recycling pool for suspended ReactRoot instances. Avoids fiber root destruction/creation on profile switches. */
  private readonly recyclingPool = new RootRecyclingPool<ReactRoot>();

  /** DevTools observer. Set externally by startDevtoolsServer(). null when devtools is off. */
  observer: RegistryObserver | null = null;

  constructor(
    renderConfig: RenderConfig,
    adapter: StreamDeckAdapter,
    onGlobalSettingsChange: (settings: JsonObject) => Promise<void>,
    wrapper?: WrapperComponent,
  ) {
    this.renderConfig = renderConfig;
    this.adapter = adapter;
    this.onGlobalSettingsChange = onGlobalSettingsChange;
    this.wrapper = wrapper;
    this.flushCoordinator = new FlushCoordinator(renderConfig);
  }

  setGlobalSettings(settings: JsonObject): void {
    if (shallowEqualSettings(this.globalSettings, settings)) {
      return;
    }
    this.globalSettings = settings;
    // Propagate to all active roots
    for (const root of this.roots.values()) {
      root.updateGlobalSettings(settings);
    }
    // Propagate to all TouchStrip roots
    for (const tbRoot of this.touchStripRoots.values()) {
      tbRoot.updateGlobalSettings(settings);
    }
  }

  // ── Create a React root for an action instance ────────────────

  create(ev: AdapterWillAppearEvent, component: ComponentType, definition: ActionDefinition): void {
    const contextId = ev.action.id;

    // Don't recreate if already exists
    if (this.roots.has(contextId) || this.touchStripActions.has(contextId)) return;

    const device = ev.action.device;
    const controller = ev.action.controllerType;
    const isEncoder = controller === "Encoder";

    // ── TouchStrip path ───────────────────────────────────────────
    if (isEncoder && definition.touchStrip) {
      this.registerTouchStripColumn(ev, definition);
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
      coordinates: ev.action.coordinates,
      isInMultiAction: ev.payload.isInMultiAction,
    };

    const canvas = getCanvasInfo(device.type, surfaceType);

    // ── Try recycling a dormant root ──────────────────────────────
    // Pool key is actionUUID:canvasType — a root can only be reused
    // for the same action type on the same surface type (same component,
    // same pixel dimensions).
    const poolKey = makePoolKey(definition.uuid, canvas.type);
    const recycled = this.recyclingPool.take(poolKey);

    if (recycled) {
      // Resume the dormant root with new context data.
      // This reuses the existing fiber tree — much cheaper than
      // creating a new one (avoids reconciler.createContainer +
      // initial mount).
      recycled.resume(
        actionInfo,
        deviceInfo,
        canvas,
        ev.payload.settings,
        this.globalSettings,
        ev.action,
        this.adapter,
        // onSettingsChange
        async (settings: JsonObject) => {
          await ev.action.setSettings(settings);
        },
        // onGlobalSettingsChange
        this.onGlobalSettingsChange,
        this.flushCoordinator,
      );

      // Emit willAppear to the recycled root (sticky for late subscribers)
      recycled.eventBus.emitSticky("willAppear", {
        settings: ev.payload.settings,
        controller,
        isInMultiAction: ev.payload.isInMultiAction,
      });

      this.roots.set(contextId, recycled);

      this.observer?.onRootCreated(contextId, recycled, {
        actionUuid: definition.uuid,
        surface: surfaceType,
        canvas,
        device: deviceInfo,
        coordinates: actionInfo.coordinates
          ? { column: actionInfo.coordinates.column, row: actionInfo.coordinates.row }
          : undefined,
      });

      return;
    }

    // ── Create a fresh root ───────────────────────────────────────

    const root = new ReactRoot(
      component,
      actionInfo,
      deviceInfo,
      canvas,
      ev.payload.settings,
      this.globalSettings,
      ev.action,
      this.adapter,
      this.renderConfig,
      // onSettingsChange
      async (settings: JsonObject) => {
        await ev.action.setSettings(settings);
      },
      // onGlobalSettingsChange
      this.onGlobalSettingsChange,
      this.wrapper,
      definition.wrapper,
      definition.dialLayout,
      this.flushCoordinator,
    );

    // Emit willAppear to the newly created root
    root.eventBus.emitSticky("willAppear", {
      settings: ev.payload.settings,
      controller,
      isInMultiAction: ev.payload.isInMultiAction,
    });

    this.roots.set(contextId, root);

    this.observer?.onRootCreated(contextId, root, {
      actionUuid: definition.uuid,
      surface: surfaceType,
      canvas,
      device: deviceInfo,
      coordinates: actionInfo.coordinates
        ? { column: actionInfo.coordinates.column, row: actionInfo.coordinates.row }
        : undefined,
    });
  }

  // ── Register an encoder column with the shared TouchStripRoot ───

  private registerTouchStripColumn(ev: AdapterWillAppearEvent, definition: ActionDefinition): void {
    const actionId = ev.action.id;
    const device = ev.action.device;
    const deviceId = device.id;

    // Determine encoder column from coordinates
    const column = ev.action.coordinates?.column;
    if (column === undefined) {
      console.warn(
        "[@fcannizzaro/streamdeck-react] Cannot determine encoder column for TouchStrip action:",
        actionId,
      );
      return;
    }

    // Find or create the TouchStripRoot for this device
    let tbRoot = this.touchStripRoots.get(deviceId);
    if (!tbRoot) {
      const deviceInfo: DeviceInfo = {
        id: deviceId,
        type: device.type,
        size: device.size,
        name: device.name,
      };

      tbRoot = new TouchStripRoot(
        definition.touchStrip!,
        deviceInfo,
        this.globalSettings,
        this.renderConfig,
        this.onGlobalSettingsChange,
        this.wrapper,
        this.flushCoordinator,
      );

      this.touchStripRoots.set(deviceId, tbRoot);

      this.observer?.onTouchStripCreated(deviceId, tbRoot, deviceInfo);
    }

    // Register this column
    tbRoot.addColumn(column, actionId, ev.action);

    // Notify observer about column change
    this.observer?.onTouchStripColumnChanged(
      deviceId,
      [...tbRoot.columnNumbers],
      tbRoot.columnActionMap,
    );

    // Track reverse mapping for event routing
    this.touchStripActions.set(actionId, deviceId);
  }

  // ── Destroy a React root ──────────────────────────────────────

  destroy(contextId: string): void {
    // ── Check if this is a TouchStrip action ──
    const deviceId = this.touchStripActions.get(contextId);
    if (deviceId) {
      const tbRoot = this.touchStripRoots.get(deviceId);
      if (tbRoot) {
        const column = tbRoot.findColumnByActionId(contextId);
        if (column !== undefined) {
          tbRoot.removeColumn(column);
        }
        // Clean up the TouchStripRoot if no columns remain
        if (tbRoot.isEmpty) {
          this.observer?.onTouchStripDestroyed(deviceId);
          tbRoot.unmount();
          this.touchStripRoots.delete(deviceId);
        }
      }
      this.touchStripActions.delete(contextId);
      return;
    }

    // ── Standard per-action root path ──
    const root = this.roots.get(contextId);
    if (root) {
      this.observer?.onRootDestroyed(contextId);

      // Suspend and pool instead of destroying.  The fiber root stays
      // alive so it can be reused if the same action type appears again
      // (e.g. profile switch, page navigation).  The pool key is
      // actionUUID:canvasType — ensures component and surface match.
      root.suspend();
      const poolKey = makePoolKey(root.uuid, root.canvasType);
      this.recyclingPool.store(poolKey, root);

      this.roots.delete(contextId);
    }
  }

  // ── Dispatch an event to a root ───────────────────────────────
  // Routes SDK events to the correct ReactRoot or TouchStripRoot.
  // For TouchStrip actions, events are remapped:
  //   touchTap → touchStripTap (per-encoder tap coordinates mapped to absolute strip position)
  //   dialRotate/Down/Up → touchStripDialRotate/Down/Up (with column number)

  dispatch<K extends keyof EventMap>(contextId: string, event: K, payload: EventMap[K]): void {
    // ── Try per-action root first ──
    const root = this.roots.get(contextId);
    if (root) {
      root.eventBus.emit(event, payload);
      this.observer?.onDispatch(contextId, event, payload);
      return;
    }

    // ── Try TouchStrip root ──
    const deviceId = this.touchStripActions.get(contextId);
    if (deviceId) {
      const tbRoot = this.touchStripRoots.get(deviceId);
      if (tbRoot) {
        this.dispatchToTouchStrip(tbRoot, contextId, event, payload);
        this.observer?.onDispatch(contextId, event, payload);
      }
    }
  }

  private dispatchToTouchStrip<K extends keyof EventMap>(
    tbRoot: TouchStripRoot,
    actionId: string,
    event: K,
    payload: EventMap[K],
  ): void {
    const column = tbRoot.findColumnByActionId(actionId);
    if (column === undefined) return;

    switch (event) {
      case "touchTap": {
        const tp = payload as unknown as TouchTapPayload;
        tbRoot.eventBus.emit("touchStripTap", {
          tapPos: [column * SEGMENT_WIDTH + tp.tapPos[0], tp.tapPos[1]],
          hold: tp.hold,
          column,
        });
        break;
      }
      case "dialRotate": {
        const dr = payload as unknown as DialRotatePayload;
        tbRoot.eventBus.emit("touchStripDialRotate", {
          column,
          ticks: dr.ticks,
          pressed: dr.pressed,
        });
        break;
      }
      case "dialDown": {
        tbRoot.eventBus.emit("touchStripDialDown", { column });
        break;
      }
      case "dialUp": {
        tbRoot.eventBus.emit("touchStripDialUp", { column });
        break;
      }
      // Other events (keyDown, sendToPlugin, etc.) are not relevant to TouchStrip
    }
  }

  // ── Update settings on a specific root ────────────────────────

  updateSettings(contextId: string, settings: JsonObject): void {
    const root = this.roots.get(contextId);
    if (root) {
      root.updateSettings(settings);
    }
    // Note: TouchStrip roots do not have per-action settings.
    // Per-encoder settings can be added in a future enhancement.
  }

  // ── Cleanup all roots ─────────────────────────────────────────

  destroyAll(): void {
    for (const [_, root] of this.roots) {
      root.unmount();
    }
    this.roots.clear();

    for (const [_, tbRoot] of this.touchStripRoots) {
      tbRoot.unmount();
    }
    this.touchStripRoots.clear();
    this.touchStripActions.clear();
    this.flushCoordinator.dispose();

    // Clear the recycling pool — unmounts all dormant roots
    this.recyclingPool.clear();
  }
}
