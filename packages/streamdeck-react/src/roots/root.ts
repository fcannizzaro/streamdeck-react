import {
  createElement,
  type ComponentType,
  type ReactElement,
} from "react";
import { reconciler } from "@/reconciler/renderer";
import { createVContainer, type VContainer } from "@/reconciler/vnode";
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
import type { JsonObject } from "@elgato/utils"
import type { Action, DialAction, KeyAction } from "@elgato/streamdeck";

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
  private renderDebounceMs: number;
  private renderConfig: RenderConfig;
  private canvas: CanvasInfo;
  private resolvedDialLayout: EncoderLayout;
  private sdkAction: Action | DialAction | KeyAction;
  private sdkInstance: StreamDeckAccess["sdk"];
  private disposed = false;

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
    sdkAction: Action | DialAction | KeyAction,
    sdkInstance: StreamDeckAccess["sdk"],
    renderConfig: RenderConfig,
    renderDebounceMs: number,
    onSettingsChange: (settings: JsonObject) => Promise<void>,
    onGlobalSettingsChange: (settings: JsonObject) => Promise<void>,
    private pluginWrapper?: WrapperComponent,
    private actionWrapper?: WrapperComponent,
    dialLayout?: EncoderLayout,
  ) {
    this.canvas = canvas;
    this.settings = { ...initialSettings };
    this.globalSettings = { ...initialGlobalSettings };
    this.sdkAction = sdkAction;
    this.sdkInstance = sdkInstance;
    this.renderConfig = renderConfig;
    this.renderDebounceMs = renderDebounceMs;
    this.resolvedDialLayout = resolveDialLayout(dialLayout);

    // Create settings mutators
    this.setSettingsFn = (partial: JsonObject) => {
      this.settings = { ...this.settings, ...partial };
      this.settingsValue = { settings: this.settings, setSettings: this.setSettingsFn };
      onSettingsChange(this.settings);
      this.scheduleRerender();
    };

    this.setGlobalSettingsFn = (partial: JsonObject) => {
      this.globalSettings = { ...this.globalSettings, ...partial };
      this.globalSettingsValue = { settings: this.globalSettings, setSettings: this.setGlobalSettingsFn };
      onGlobalSettingsChange(this.globalSettings);
      this.scheduleRerender();
    };

    // Initialize cached context values (stable references until data changes)
    this.streamDeckValue = { action: this.sdkAction, sdk: this.sdkInstance };
    this.settingsValue = { settings: this.settings, setSettings: this.setSettingsFn };
    this.globalSettingsValue = { settings: this.globalSettings, setSettings: this.setGlobalSettingsFn };

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
    if (canvas.type === "dial" || canvas.type === "touch") {
      if ("setFeedbackLayout" in this.sdkAction) {
        (
          this.sdkAction as DialAction & {
            setFeedbackLayout(layout: EncoderLayout): Promise<void>;
          }
        ).setFeedbackLayout(this.resolvedDialLayout);
      }
    }

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
                createElement(
                  SettingsContext.Provider,
                  { value: this.settingsValue },
                  child,
                ),
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

  // ── Flush: VNode → Satori → SVG → setImage ───────────────────

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

    try {
      const dataUri = await renderToDataUri(
        this.container,
        this.canvas.width,
        this.canvas.height,
        this.renderConfig,
      );

      if (dataUri === null || this.disposed) return;

      // Push to Stream Deck
      if (this.canvas.type === "key") {
        if ("setImage" in this.sdkAction) {
          await (this.sdkAction as KeyAction).setImage(dataUri);
        }
      } else if (this.canvas.type === "dial") {
        if ("setFeedback" in this.sdkAction) {
          await (this.sdkAction as DialAction).setFeedback({
            canvas: dataUri,
            title: "",
          });
        }
      } else if (this.canvas.type === "touch") {
        if ("setFeedback" in this.sdkAction) {
          await (this.sdkAction as DialAction).setFeedback({
            canvas: dataUri,
          });
        }
      }
    } catch (err) {
      console.error("[@fcannizzaro/streamdeck-react] Render error:", err);
    }
  }

  // ── External updates from SDK events ──────────────────────────

  updateSettings(settings: JsonObject): void {
    this.settings = { ...settings };
    this.settingsValue = { settings: this.settings, setSettings: this.setSettingsFn };
    this.eventBus.emit("settingsChanged", settings);
    this.scheduleRerender();
  }

  updateGlobalSettings(settings: JsonObject): void {
    this.globalSettings = { ...settings };
    this.globalSettingsValue = { settings: this.globalSettings, setSettings: this.setGlobalSettingsFn };
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
