import { createElement, type ComponentType, type ReactElement } from "react";
import { reconciler } from "@/reconciler/renderer";
import { createVContainer, clearDirtyFlags, type VContainer } from "@/reconciler/vnode";
import { renderToDataUri, type RenderConfig } from "@/render/pipeline";
import { EventBus } from "@/context/event-bus";
import {
  SettingsContext,
  GlobalSettingsContext,
  ActionContext,
  DeviceContext,
  CanvasContext,
  EventBusContext,
  StreamDeckContext,
  type SettingsContextValue,
  type GlobalSettingsContextValue,
} from "@/context/providers";
import type {
  ActionInfo,
  CanvasInfo,
  DeviceInfo,
  EncoderLayout,
  StreamDeckAccess,
  WrapperComponent,
} from "@/types";
import { partialHasChanges, shallowEqualSettings } from "./settings-equality";
import type { JsonObject } from "@elgato/utils";
import type { AdapterActionHandle, StreamDeckAdapter } from "@/adapter/types";

// ── Per-Action React Root ───────────────────────────────────────────
//
// Each visible Stream Deck key or dial gets its own ReactRoot instance.
// The root owns a complete React fiber tree and drives the render
// pipeline independently.
//
// Lifecycle:
//
//   onWillAppear (from SDK)
//     ↓
//   new ReactRoot(component, ...)
//     ├─ createVContainer → createContainer (fiber root)
//     ├─ Set feedback layout (encoder only)
//     ├─ Initial render() → React commits → VNode tree built
//     └─ resetAfterCommit → microtask → flush()
//                                          ↓
//   ┌─────────── flush loop ───────────────┤
//   │  fixed debounce (0ms or configured)  │
//   │  → doFlush:                          │
//   │    renderToDataUri(VNode→pixels)     │
//   │    → setImage/setFeedback (hardware) │
//   └──────────────────────────────────────┘
//     ↓
//   onWillDisappear (from SDK)
//     ↓
//   unmount() → cleanup timers, fiber root, event bus
//
// Provider nesting order (stable contexts outermost, volatile innermost):
//   Action → Device → Canvas → EventBus → StreamDeck → GlobalSettings → Settings
//
// Why this order matters:
//   React propagates context changes by walking the subtree.  Placing
//   rarely-changing contexts (Action, Device) outermost means their
//   Provider nodes never re-render, reducing reconciler work.  Settings
//   (innermost) changes most often but only triggers re-render below it.

const DEFAULT_DIAL_LAYOUT: Exclude<EncoderLayout, string> = {
  id: "com.example.plugin.react-layout",
  items: [
    {
      key: "canvas",
      type: "pixmap",
      rect: [0, 0, 200, 100],
    },
  ],
};

// ── Root Instance ───────────────────────────────────────────────────

export class ReactRoot {
  readonly eventBus = new EventBus();
  private container: VContainer;
  private fiberRoot: ReturnType<typeof reconciler.createContainer>;
  private settings: JsonObject;
  private globalSettings: JsonObject;
  private setSettingsFn: (partial: JsonObject) => void;
  private setGlobalSettingsFn: (partial: JsonObject) => void;
  // Stream Deck hardware refreshes at max 30Hz.  Half-period debounce
  // (17ms) fires at the midpoint between ticks, coalescing high-frequency
  // state updates without adding perceptible latency.
  private readonly renderDebounceMs = 17;
  private renderConfig: RenderConfig;
  private canvas: CanvasInfo;
  private resolvedDialLayout: EncoderLayout;
  private action: AdapterActionHandle;
  private adapter: StreamDeckAdapter;
  private disposed = false;

  // ── Performance diagnostics ───────────────────────────────────
  private _renderCount = 0;
  private _lastRenderReport = 0;
  private static readonly RENDER_WARN_THRESHOLD = 30;

  /** Last data URI successfully sent to hardware. Used by devtools snapshots. */
  lastDataUri: string | null = null;

  /**
   * When true, doFlush skips pushing the normal image to hardware.
   * Set by the devtools bridge while a highlight overlay is active so that
   * rapid re-renders don't overwrite the highlight on the device.
   * The highlight path calls pushImage directly (bypassing this flag).
   */
  suppressHardwarePush = false;

  /** Push an arbitrary data URI to the hardware. Used by devtools highlight overlay. */
  async pushImage(dataUri: string): Promise<void> {
    if (this.disposed) return;

    // The adapter action handle always has all methods — inapplicable
    // ones no-op internally.  We route based on canvas type which is
    // known at root creation time.
    if (this.canvas.type === "key") {
      await this.action.setImage(dataUri);
    } else if (this.canvas.type === "dial") {
      await this.action.setFeedback({
        canvas: dataUri,
        title: "",
      });
    } else if (this.canvas.type === "touch") {
      await this.action.setFeedback({
        canvas: dataUri,
      });
    }
  }

  /** Exposes the VContainer for devtools inspection. */
  get vcontainer(): VContainer {
    return this.container;
  }

  // Cached context values — avoid new object references on every render
  private streamDeckValue: StreamDeckAccess;
  private settingsValue: SettingsContextValue;
  private globalSettingsValue: GlobalSettingsContextValue;

  constructor(
    private component: ComponentType,
    private actionInfo: ActionInfo,
    private deviceInfo: DeviceInfo,
    canvas: CanvasInfo,
    initialSettings: JsonObject,
    initialGlobalSettings: JsonObject,
    action: AdapterActionHandle,
    adapter: StreamDeckAdapter,
    renderConfig: RenderConfig,
    onSettingsChange: (settings: JsonObject) => Promise<void>,
    onGlobalSettingsChange: (settings: JsonObject) => Promise<void>,
    private pluginWrapper?: WrapperComponent,
    private actionWrapper?: WrapperComponent,
    dialLayout?: EncoderLayout,
  ) {
    this.canvas = canvas;
    this.settings = { ...initialSettings };
    this.globalSettings = { ...initialGlobalSettings };
    this.action = action;
    this.adapter = adapter;
    this.renderConfig = renderConfig;
    this.resolvedDialLayout = resolveDialLayout(dialLayout);

    // Create settings mutators.
    // Each performs a shallow-compare guard: if no key in `partial`
    // actually differs from the current value, we still persist the
    // requested settings write but skip the merge, context value
    // allocation, and re-render.  This avoids unnecessary VNode tree
    // walks when the SDK pushes the same settings object back.
    this.setSettingsFn = (partial: JsonObject) => {
      const hasChanges = partialHasChanges(this.settings, partial);
      const nextSettings = hasChanges ? { ...this.settings, ...partial } : this.settings;
      onSettingsChange(nextSettings);
      if (!hasChanges) return;
      this.settings = nextSettings;
      this.settingsValue = { settings: this.settings, setSettings: this.setSettingsFn };
      this.scheduleRerender();
    };

    this.setGlobalSettingsFn = (partial: JsonObject) => {
      const hasChanges = partialHasChanges(this.globalSettings, partial);
      const nextSettings = hasChanges
        ? { ...this.globalSettings, ...partial }
        : this.globalSettings;
      onGlobalSettingsChange(nextSettings);
      if (!hasChanges) return;
      this.globalSettings = nextSettings;
      this.globalSettingsValue = {
        settings: this.globalSettings,
        setSettings: this.setGlobalSettingsFn,
      };
      this.scheduleRerender();
    };

    // Initialize cached context values (stable references until data changes)
    this.streamDeckValue = { action: this.action, adapter: this.adapter };
    this.settingsValue = { settings: this.settings, setSettings: this.setSettingsFn };
    this.globalSettingsValue = {
      settings: this.globalSettings,
      setSettings: this.setGlobalSettingsFn,
    };

    // Create virtual container with render callback
    this.container = createVContainer(() => {
      this.flush();
    });

    // Create the fiber root
    this.fiberRoot = reconciler.createContainer(
      this.container,
      0, // LegacyRoot tag
      null, // hydrationCallbacks
      false, // isStrictMode
      null, // concurrentUpdatesByDefaultOverride
      "", // identifierPrefix
      (err: Error) => {
        console.error("[@fcannizzaro/streamdeck-react] Uncaught error:", err);
      },
      (err: Error) => {
        console.error("[@fcannizzaro/streamdeck-react] Caught error:", err);
      },
      (err: Error) => {
        console.error("[@fcannizzaro/streamdeck-react] Recoverable error:", err);
      },
      () => {}, // onDefaultTransitionIndicator
    );

    // For encoder surfaces, ensure the feedback layout has a canvas element.
    // This must happen before the first render so the SDK processes the layout
    // change before setFeedback is called.
    // The adapter action handle always has setFeedbackLayout — it no-ops
    // internally for non-encoder surfaces.
    if (canvas.type === "dial" || canvas.type === "touch") {
      const layout = this.resolvedDialLayout;
      this.action.setFeedbackLayout(
        typeof layout === "string" ? layout : (layout as unknown as Record<string, unknown>),
      );
    }

    // Set eventBus owner for devtools observer
    this.eventBus.ownerId = actionInfo.id;
    this.eventBus.ownerUuid = actionInfo.uuid;

    // Initial render
    this.render();
  }

  // ── Render the component tree into the fiber root ─────────────

  private render(): void {
    const element = this.buildTree();
    reconciler.updateContainer(element, this.fiberRoot, null, () => {});
  }

  private buildTree(): ReactElement {
    let child = createElement(this.component);

    if (this.actionWrapper) {
      child = createElement(this.actionWrapper, null, child);
    }

    if (this.pluginWrapper) {
      child = createElement(this.pluginWrapper, null, child);
    }

    // Provider order: stable contexts outermost, volatile innermost.
    // Stable: Action, Device, Canvas, EventBus, StreamDeck (never change for this root).
    // Volatile: GlobalSettings (changes less often), Settings (changes most often).
    return createElement(
      ActionContext.Provider,
      { value: this.actionInfo },
      createElement(
        DeviceContext.Provider,
        { value: this.deviceInfo },
        createElement(
          CanvasContext.Provider,
          { value: this.canvas },
          createElement(
            EventBusContext.Provider,
            { value: this.eventBus },
            createElement(
              StreamDeckContext.Provider,
              { value: this.streamDeckValue },
              createElement(
                GlobalSettingsContext.Provider,
                { value: this.globalSettingsValue },
                createElement(SettingsContext.Provider, { value: this.settingsValue }, child),
              ),
            ),
          ),
        ),
      ),
    );
  }

  // ── Schedule a re-render (for settings changes from outside) ──

  private scheduleRerender(): void {
    if (this.disposed) return;
    this.render();
  }

  // ── Flush: VNode → Takumi → raster → setImage ─────────────────

  private async flush(): Promise<void> {
    if (this.disposed) return;

    // Apply debounce for high-frequency updates
    if (this.renderDebounceMs > 0 && this.container.renderTimer !== null) {
      clearTimeout(this.container.renderTimer);
    }

    if (this.renderDebounceMs > 0) {
      this.container.renderTimer = setTimeout(async () => {
        this.container.renderTimer = null;
        await this.doFlush();
      }, this.renderDebounceMs);
    } else {
      await this.doFlush();
    }
  }

  private async doFlush(): Promise<void> {
    if (this.disposed) return;

    // Performance diagnostics: render frequency counter
    if (this.renderConfig.debug) {
      this._renderCount++;
      const now = Date.now();
      if (now - this._lastRenderReport > 1000) {
        if (this._renderCount > ReactRoot.RENDER_WARN_THRESHOLD) {
          console.warn(
            `[@fcannizzaro/streamdeck-react] Action ${this.actionInfo.id} rendered ${this._renderCount}x in 1s`,
          );
        }
        this._renderCount = 0;
        this._lastRenderReport = now;
      }
    }

    try {
      const dataUri = await renderToDataUri(
        this.container,
        this.canvas.width,
        this.canvas.height,
        this.renderConfig,
      );

      clearDirtyFlags(this.container);

      if (dataUri === null || this.disposed) return;

      // Store for devtools snapshots (before push so it's always available for restore)
      this.lastDataUri = dataUri;

      // Push to Stream Deck (skipped when devtools highlight overlay is active)
      if (!this.suppressHardwarePush) {
        this.pushImage(dataUri).catch((err) => {
          console.error("[@fcannizzaro/streamdeck-react] Hardware push error:", err);
        });
      }
    } catch (err) {
      console.error("[@fcannizzaro/streamdeck-react] Render error:", err);
    }
  }

  // ── External updates from SDK events ──────────────────────────

  updateSettings(settings: JsonObject): void {
    if (shallowEqualSettings(this.settings, settings)) {
      this.eventBus.emit("settingsChanged", settings);
      return;
    }
    this.settings = { ...settings };
    this.settingsValue = { settings: this.settings, setSettings: this.setSettingsFn };
    this.eventBus.emit("settingsChanged", settings);
    this.scheduleRerender();
  }

  updateGlobalSettings(settings: JsonObject): void {
    if (shallowEqualSettings(this.globalSettings, settings)) {
      return;
    }
    this.globalSettings = { ...settings };
    this.globalSettingsValue = {
      settings: this.globalSettings,
      setSettings: this.setGlobalSettingsFn,
    };
    this.scheduleRerender();
  }

  // ── Unmount & Cleanup ─────────────────────────────────────────

  unmount(): void {
    this.disposed = true;
    if (this.container.renderTimer !== null) {
      clearTimeout(this.container.renderTimer);
    }
    this.eventBus.emit("willDisappear", undefined as never);
    reconciler.updateContainer(null, this.fiberRoot, null, () => {});
    this.eventBus.removeAllListeners();
  }
}

function resolveDialLayout(layout?: EncoderLayout): EncoderLayout {
  if (layout) return layout;

  return {
    ...DEFAULT_DIAL_LAYOUT,
    items: DEFAULT_DIAL_LAYOUT.items.map((item) => ({ ...item })),
  };
}
