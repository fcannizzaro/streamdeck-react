import {
  createElement,
  type ComponentType,
  type ReactElement,
} from "react";
import { reconciler } from "@/reconciler/renderer";
import { createVContainer, type VContainer } from "@/reconciler/vnode";
import { renderToRaw, sliceToDataUri, type RenderConfig } from "@/render/pipeline";
import { EventBus } from "@/context/event-bus";
import {
  DeviceContext,
  EventBusContext,
  GlobalSettingsContext,
  type GlobalSettingsContextValue,
} from "@/context/providers";
import { TouchBarContext } from "@/context/touchbar-context";
import type {
  DeviceInfo,
  EncoderLayout,
  TouchBarInfo,
  WrapperComponent,
} from "@/types";
import type { DialAction } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

// ── Constants ───────────────────────────────────────────────────────

const SEGMENT_WIDTH = 200;
const SEGMENT_HEIGHT = 100;
const DEFAULT_TOUCHBAR_FPS = 60;

const TOUCHBAR_LAYOUT: Exclude<EncoderLayout, string> = {
  id: "com.streamdeck-react.touchbar-layout",
  items: [
    {
      key: "canvas",
      type: "pixmap",
      rect: [0, 0, SEGMENT_WIDTH, SEGMENT_HEIGHT],
    },
  ],
};

// ── Column Entry ────────────────────────────────────────────────────

interface ColumnEntry {
  actionId: string;
  sdkAction: DialAction;
}

// ── Touch Bar Root ──────────────────────────────────────────────────
// A shared React fiber root that renders ONE component tree for the
// full-width touch strip. The rendered image is sliced and distributed
// to individual encoder actions via setFeedback.

export class TouchBarRoot {
  readonly eventBus = new EventBus();
  private container: VContainer;
  private fiberRoot: ReturnType<typeof reconciler.createContainer>;
  private columns = new Map<number, ColumnEntry>();
  private globalSettings: JsonObject;
  private setGlobalSettingsFn: (partial: JsonObject) => void;
  private renderDebounceMs: number;
  private renderConfig: RenderConfig;
  private deviceInfo: DeviceInfo;
  private disposed = false;
  private fps: number;
  private pluginWrapper?: WrapperComponent;

  // Cached context values
  private globalSettingsValue: GlobalSettingsContextValue;
  private touchBarValue: TouchBarInfo;

  constructor(
    private component: ComponentType,
    deviceInfo: DeviceInfo,
    initialGlobalSettings: JsonObject,
    renderConfig: RenderConfig,
    renderDebounceMs: number,
    onGlobalSettingsChange: (settings: JsonObject) => Promise<void>,
    pluginWrapper?: WrapperComponent,
    touchBarFPS?: number,
  ) {
    this.deviceInfo = deviceInfo;
    this.globalSettings = { ...initialGlobalSettings };
    this.renderConfig = renderConfig;
    this.fps = touchBarFPS ?? DEFAULT_TOUCHBAR_FPS;
    // When touchBarFPS is explicitly set, derive debounce from it;
    // otherwise fall back to the global renderDebounceMs.
    this.renderDebounceMs = touchBarFPS != null
      ? Math.max(1, Math.round(1000 / touchBarFPS))
      : renderDebounceMs;
    this.pluginWrapper = pluginWrapper;

    // Global settings mutator
    this.setGlobalSettingsFn = (partial: JsonObject) => {
      this.globalSettings = { ...this.globalSettings, ...partial };
      this.globalSettingsValue = {
        settings: this.globalSettings,
        setSettings: this.setGlobalSettingsFn,
      };
      onGlobalSettingsChange(this.globalSettings);
      this.scheduleRerender();
    };

    // Initial context values
    this.globalSettingsValue = {
      settings: this.globalSettings,
      setSettings: this.setGlobalSettingsFn,
    };

    this.touchBarValue = {
      width: 0,
      height: SEGMENT_HEIGHT,
      columns: [],
      segmentWidth: SEGMENT_WIDTH,
      fps: this.fps,
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
        console.error("[@fcannizzaro/streamdeck-react] TouchBar uncaught error:", err);
      },
      (err: Error) => {
        console.error("[@fcannizzaro/streamdeck-react] TouchBar caught error:", err);
      },
      (err: Error) => {
        console.error("[@fcannizzaro/streamdeck-react] TouchBar recoverable error:", err);
      },
      () => {}, // onDefaultTransitionIndicator
    );
  }

  // ── Column Management ─────────────────────────────────────────

  addColumn(column: number, actionId: string, sdkAction: DialAction): void {
    this.columns.set(column, { actionId, sdkAction });

    // The manifest's encoder layout (e.g. "$A0") provides the canvas pixmap.
    // No setFeedbackLayout call needed — it can conflict with the manifest layout.

    // Recompute geometry and render
    this.updateTouchBarInfo();
    this.scheduleRerender();
  }

  removeColumn(column: number): void {
    this.columns.delete(column);

    if (this.columns.size === 0) {
      // Will be cleaned up by the registry
      return;
    }

    this.updateTouchBarInfo();
    this.scheduleRerender();
  }

  get isEmpty(): boolean {
    return this.columns.size === 0;
  }

  findColumnByActionId(actionId: string): number | undefined {
    for (const [column, entry] of this.columns) {
      if (entry.actionId === actionId) return column;
    }
    return undefined;
  }

  // ── Touch Bar Info ────────────────────────────────────────────

  private updateTouchBarInfo(): void {
    const sortedColumns = [...this.columns.keys()].sort((a, b) => a - b);
    const maxCol = sortedColumns.length > 0
      ? sortedColumns[sortedColumns.length - 1]! + 1
      : 0;

    this.touchBarValue = {
      width: maxCol * SEGMENT_WIDTH,
      height: SEGMENT_HEIGHT,
      columns: sortedColumns,
      segmentWidth: SEGMENT_WIDTH,
      fps: this.fps,
    };
  }

  // ── Render ────────────────────────────────────────────────────

  private render(): void {
    if (this.disposed) return;
    const element = this.buildTree();
    reconciler.updateContainer(element, this.fiberRoot, null, () => {});
  }

  private buildTree(): ReactElement {
    let child = createElement(this.component);

    if (this.pluginWrapper) {
      child = createElement(this.pluginWrapper, null, child);
    }

    // Provider order: stable outermost, volatile innermost.
    return createElement(
      TouchBarContext.Provider,
      { value: this.touchBarValue },
      createElement(
        DeviceContext.Provider,
        { value: this.deviceInfo },
        createElement(
          EventBusContext.Provider,
          { value: this.eventBus },
          createElement(
            GlobalSettingsContext.Provider,
            { value: this.globalSettingsValue },
            child,
          ),
        ),
      ),
    );
  }

  private scheduleRerender(): void {
    if (this.disposed) return;
    this.render();
  }

  // ── Flush: VNode → raw RGBA → buffer crop → setFeedback ────────

  private async flush(): Promise<void> {
    if (this.disposed) return;

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
    if (this.disposed || this.columns.size === 0) return;

    try {
      const width = this.touchBarValue.width;
      if (width === 0) return;

      // Single Takumi render → raw RGBA pixels
      const result = await renderToRaw(
        this.container,
        width,
        SEGMENT_HEIGHT,
        this.renderConfig,
      );

      if (result === null || this.disposed) return;

      // Crop each segment directly from the raw buffer (no re-rendering)
      const feedbackPromises: Promise<void>[] = [];
      for (const [column, entry] of this.columns) {
        const sliceUri = sliceToDataUri(
          result.buffer,
          result.width,
          result.height,
          column,
          SEGMENT_WIDTH,
          SEGMENT_HEIGHT,
        );
        feedbackPromises.push(
          entry.sdkAction.setFeedback({ canvas: sliceUri }),
        );
      }
      await Promise.all(feedbackPromises);
    } catch (err) {
      console.error("[@fcannizzaro/streamdeck-react] TouchBar render error:", err);
    }
  }

  // ── External Updates ──────────────────────────────────────────

  updateGlobalSettings(settings: JsonObject): void {
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
    this.columns.clear();
  }
}
