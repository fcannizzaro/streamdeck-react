import { createElement, type ComponentType, type ReactElement } from "react";
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
import type { FlushCoordinator, FlushableRoot } from "./flush-coordinator";
import { partialHasChanges, shallowEqualSettings } from "./settings-equality";
import type { JsonObject } from "@elgato/utils";
import type { Action, DialAction, KeyAction } from "@elgato/streamdeck";

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
//   │  adaptive debounce (0ms/16ms/Nms)    │
//   │  → submitFlush → FlushCoordinator    │
//   │  → doFlush:                          │
//   │    renderToDataUri(VNode→pixels)     │
//   │    → setImage/setFeedback (hardware) │
//   │  ← if _pendingFlush, loop            │
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

export class ReactRoot implements FlushableRoot {
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

  // ── Performance diagnostics ───────────────────────────────────
  private _renderCount = 0;
  private _lastRenderReport = 0;
  private static readonly RENDER_WARN_THRESHOLD = 30;

  // ── Frame skipping ────────────────────────────────────────────
  // Prevents queue buildup when renders are slower than commit rate.
  // If doFlush() is already running, the next flush request just
  // sets _pendingFlush=true.  When doFlush finishes, it checks the
  // flag and runs one more flush — coalescing all intermediate
  // commits into a single render pass.
  private _rendering = false;
  private _pendingFlush = false;

  // ── Adaptive debounce ─────────────────────────────────────────
  // Detects rendering patterns to choose the optimal debounce:
  //
  //   Animating (>2 renders in 100ms window):  0ms debounce
  //     → Spring/tween animations need every frame delivered
  //
  //   Interactive (user input within 500ms):   min(configured, 16ms)
  //     → Key press/dial rotate needs fast visual feedback
  //
  //   Idle (no recent activity):               configured debounce
  //     → Settings changes, initial render — batch updates
  //
  // _recentRenders tracks timestamps in a sliding window.
  // Stale entries are pruned on each access.
  private _recentRenders: number[] = [];
  private _lastInteraction = 0;
  private static readonly ANIMATION_WINDOW_MS = 100;
  private static readonly ANIMATION_THRESHOLD = 2; // >2 renders in window → animating
  private static readonly INTERACTION_COOLDOWN_MS = 500;

  // ── Render Priority ───────────────────────────────────────────
  // Used by FlushCoordinator to order flushes across all active roots.
  // Lower number = higher priority = flushed first.
  //   0 = animating (many recent renders → needs every frame)
  //   1 = interactive (recent user input → fast feedback needed)
  //   2 = normal (default)
  //   3 = idle (no flush for >2s → low urgency)
  //
  // This ensures animated keys get first access to the USB bus
  // when multiple keys need to update simultaneously.
  private static readonly IDLE_THRESHOLD_MS = 2000;
  private _lastFlushTime = 0;

  /** Current render priority (lower = higher priority). Used by flush coordinator for ordering. */
  get priority(): number {
    const now = Date.now();

    // Prune stale timestamps (same window as adaptive debounce)
    const cutoff = now - ReactRoot.ANIMATION_WINDOW_MS;
    while (this._recentRenders.length > 0 && this._recentRenders[0]! < cutoff) {
      this._recentRenders.shift();
    }

    // Animating: many recent renders
    if (this._recentRenders.length > ReactRoot.ANIMATION_THRESHOLD) {
      return 0;
    }

    // Interactive: recent user input
    if (now - this._lastInteraction < ReactRoot.INTERACTION_COOLDOWN_MS) {
      return 1;
    }

    // Idle: no flush for a while
    if (this._lastFlushTime > 0 && now - this._lastFlushTime > ReactRoot.IDLE_THRESHOLD_MS) {
      return 3;
    }

    // Normal
    return 2;
  }

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
    sdkAction: Action | DialAction | KeyAction,
    sdkInstance: StreamDeckAccess["sdk"],
    renderConfig: RenderConfig,
    renderDebounceMs: number,
    onSettingsChange: (settings: JsonObject) => Promise<void>,
    onGlobalSettingsChange: (settings: JsonObject) => Promise<void>,
    private flushCoordinator?: FlushCoordinator,
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
    this.streamDeckValue = { action: this.sdkAction, sdk: this.sdkInstance };
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
    if (canvas.type === "dial" || canvas.type === "touch") {
      if ("setFeedbackLayout" in this.sdkAction) {
        (
          this.sdkAction as DialAction & {
            setFeedbackLayout(layout: EncoderLayout): Promise<void>;
          }
        ).setFeedbackLayout(this.resolvedDialLayout);
      }
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

  /** Record a user interaction (keyDown, dialRotate, etc.) for adaptive debounce. */
  markInteraction(): void {
    this._lastInteraction = Date.now();
  }

  /** Compute effective debounce based on recent render frequency and interaction state. */
  private get effectiveDebounceMs(): number {
    const now = Date.now();

    // Prune stale timestamps
    const cutoff = now - ReactRoot.ANIMATION_WINDOW_MS;
    while (this._recentRenders.length > 0 && this._recentRenders[0]! < cutoff) {
      this._recentRenders.shift();
    }

    // If many recent renders → likely animating → no debounce
    if (this._recentRenders.length > ReactRoot.ANIMATION_THRESHOLD) {
      return 0;
    }

    // Recent user interaction → short debounce for responsiveness
    if (now - this._lastInteraction < ReactRoot.INTERACTION_COOLDOWN_MS) {
      return Math.min(this.renderDebounceMs, 16);
    }

    // Idle → use configured debounce
    return this.renderDebounceMs;
  }

  private async flush(): Promise<void> {
    if (this.disposed) return;

    // Frame skipping: if a render is in progress, just mark pending
    if (this._rendering) {
      this._pendingFlush = true;
      return;
    }

    // Track render timestamp for adaptive debounce
    this._recentRenders.push(Date.now());

    const debounce = this.effectiveDebounceMs;

    // Apply debounce for high-frequency updates
    if (debounce > 0 && this.container.renderTimer !== null) {
      clearTimeout(this.container.renderTimer);
    }

    if (debounce > 0) {
      this.container.renderTimer = setTimeout(() => {
        this.container.renderTimer = null;
        this.submitFlush();
      }, debounce);
    } else {
      this.submitFlush();
    }
  }

  /**
   * Submit this root for flushing. Routes through the coordinator
   * (priority-ordered) when available, or flushes directly.
   */
  private submitFlush(): void {
    if (this.disposed) return;
    if (this.flushCoordinator) {
      this.flushCoordinator.requestFlush(this);
    } else {
      this.doFlush();
    }
  }

  /**
   * Execute the flush. Called by FlushCoordinator in priority order,
   * or directly when no coordinator is present.
   */
  async executeFlush(): Promise<void> {
    await this.doFlush();
  }

  private async doFlush(): Promise<void> {
    if (this.disposed) return;

    this._rendering = true;
    this._pendingFlush = false;
    this._lastFlushTime = Date.now();

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

      if (dataUri === null || this.disposed) return;

      // Store for devtools snapshots (before push so it's always available for restore)
      this.lastDataUri = dataUri;

      // Double buffering: fire-and-forget the hardware push.
      // The next render can start immediately without waiting for USB transfer.
      if (!this.suppressHardwarePush) {
        this.pushImage(dataUri).catch((err) => {
          console.error("[@fcannizzaro/streamdeck-react] Hardware push error:", err);
        });
      }
    } catch (err) {
      console.error("[@fcannizzaro/streamdeck-react] Render error:", err);
    } finally {
      this._rendering = false;

      // If a flush was requested while we were rendering, drain it now
      if (this._pendingFlush && !this.disposed) {
        this._pendingFlush = false;
        await this.doFlush();
      }
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
