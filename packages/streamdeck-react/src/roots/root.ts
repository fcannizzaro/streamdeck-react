import { createElement, type ComponentType, type ReactElement } from "react";
import { getReconciler } from "@/reconciler/renderer";
import { createVContainer, clearDirtyFlags, type VContainer } from "@/reconciler/vnode";
import { renderToDataUri, type RenderConfig } from "@/render/pipeline";
import { EventBus } from "@/context/event-bus";
import {
  SettingsContext,
  GlobalSettingsContext,
  RootContext,
  EventBusContext,
  CoordinatorContext,
  ThemeContext,
  type RootContextValue,
  type SettingsContextValue,
  type GlobalSettingsContextValue,
  type ThemeContextValue,
} from "@/context/providers";
import type { ActionCoordinator } from "@/coordinator/index";
import type { ThemeDefinition } from "@/theme/index";
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
import { FlushPriority, type FlushableRoot, type FlushCoordinator } from "./flush-coordinator";

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

export class ReactRoot implements FlushableRoot {
  eventBus = new EventBus();
  private container: VContainer;
  private fiberRoot: ReturnType<ReturnType<typeof getReconciler>["createContainer"]>;
  private settings: JsonObject;
  private globalSettings: JsonObject;
  private setSettingsFn: (partial: JsonObject) => void;
  private setGlobalSettingsFn: (partial: JsonObject) => void;
  private renderConfig: RenderConfig;
  private canvas: CanvasInfo;
  private resolvedDialLayout: EncoderLayout;
  private action: AdapterActionHandle;
  private adapter: StreamDeckAdapter;
  private disposed = false;
  private flushCoordinator: FlushCoordinator | null;

  // Stored callbacks — referenced by closures so they can be swapped
  // on resume() without recreating the closure functions.
  private _onSettingsChange: (settings: JsonObject) => Promise<void>;
  private _onGlobalSettingsChange: (settings: JsonObject) => Promise<void>;

  // ── FlushableRoot interface ───────────────────────────────────
  flushId: string;

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
  private rootContextValue: RootContextValue;
  private settingsValue: SettingsContextValue;
  private globalSettingsValue: GlobalSettingsContextValue;
  private themeValue: ThemeContextValue;

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
    flushCoordinator?: FlushCoordinator,
    private coordinator?: ActionCoordinator | null,
    private themeDefinition?: ThemeDefinition | null,
  ) {
    this.canvas = canvas;
    this.settings = { ...initialSettings };
    this.globalSettings = { ...initialGlobalSettings };
    this.action = action;
    this.adapter = adapter;
    this.renderConfig = renderConfig;
    this.resolvedDialLayout = resolveDialLayout(dialLayout);
    this.flushCoordinator = flushCoordinator ?? null;
    this.flushId = actionInfo.id;

    // Store callbacks as instance fields so resume() can swap them
    // without recreating the closure functions.
    this._onSettingsChange = onSettingsChange;
    this._onGlobalSettingsChange = onGlobalSettingsChange;

    // Create settings mutators.
    // Each performs a shallow-compare guard: if no key in `partial`
    // actually differs from the current value, we still persist the
    // requested settings write but skip the merge, context value
    // allocation, and re-render.  This avoids unnecessary VNode tree
    // walks when the SDK pushes the same settings object back.
    //
    // Closures read from this._onSettingsChange / this._onGlobalSettingsChange
    // (instance fields) instead of capturing the constructor parameter
    // directly.  This allows resume() to swap the callback reference
    // without recreating the closure — essential for root recycling.
    this.setSettingsFn = (partial: JsonObject) => {
      const hasChanges = partialHasChanges(this.settings, partial);
      const nextSettings = hasChanges ? { ...this.settings, ...partial } : this.settings;
      this._onSettingsChange(nextSettings);
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
      this._onGlobalSettingsChange(nextSettings);
      if (!hasChanges) return;
      this.globalSettings = nextSettings;
      this.globalSettingsValue = {
        settings: this.globalSettings,
        setSettings: this.setGlobalSettingsFn,
      };
      this.scheduleRerender();
    };

    // Initialize cached context values (stable references until data changes)
    // RootContext merges 4 stable values into one object — constructed once,
    // never changes for this root's lifetime.
    this.rootContextValue = {
      action: this.actionInfo,
      device: this.deviceInfo,
      canvas: this.canvas,
      streamDeck: { action: this.action, adapter: this.adapter },
    };
    this.settingsValue = { settings: this.settings, setSettings: this.setSettingsFn };
    this.globalSettingsValue = {
      settings: this.globalSettings,
      setSettings: this.setGlobalSettingsFn,
    };
    this.themeValue = {
      theme: this.themeDefinition ?? null,
      setTheme: (theme: ThemeDefinition) => {
        this.themeDefinition = theme;
        this.themeValue = { ...this.themeValue, theme };
        this.scheduleRerender();
      },
    };

    // Create virtual container with render callback
    this.container = createVContainer(() => {
      this.flush();
    });

    // Create the fiber root
    this.fiberRoot = getReconciler().createContainer(
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
    getReconciler().updateContainer(element, this.fiberRoot, null, () => {});
  }

  private buildTree(): ReactElement {
    let child = createElement(this.component);

    if (this.actionWrapper) {
      child = createElement(this.actionWrapper, null, child);
    }

    if (this.pluginWrapper) {
      child = createElement(this.pluginWrapper, null, child);
    }

    // Wrap with a theme div that injects CSS custom properties.
    // The variables cascade to all children via CSS inheritance.
    // Only added when a theme is configured — zero cost when not.
    if (this.themeDefinition?.variables) {
      child = createElement(
        "div",
        { style: { display: "contents", ...this.themeDefinition.variables } },
        child,
      );
    }

    // Provider order: stable contexts outermost, volatile innermost.
    // Stable: CoordinatorContext (plugin-level, never changes), ThemeContext,
    //   RootContext (merged action/device/canvas/streamDeck), EventBus.
    // Volatile: GlobalSettings (changes less often), Settings (changes most often).
    //
    // CoordinatorContext and ThemeContext are outermost because they
    // are plugin-level and change rarely (theme) or never (coordinator).
    return createElement(
      CoordinatorContext.Provider,
      { value: this.coordinator ?? null },
      createElement(
        ThemeContext.Provider,
        { value: this.themeValue },
        createElement(
          RootContext.Provider,
          { value: this.rootContextValue },
          createElement(
            EventBusContext.Provider,
            { value: this.eventBus },
            createElement(
              GlobalSettingsContext.Provider,
              { value: this.globalSettingsValue },
              createElement(SettingsContext.Provider, { value: this.settingsValue }, child),
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

  private flush(): void {
    if (this.disposed) return;

    // Delegate to the FlushCoordinator for batched, priority-ordered
    // processing.  The coordinator handles debouncing, so individual
    // roots no longer manage their own timers.
    if (this.flushCoordinator) {
      this.flushCoordinator.requestFlush(this, FlushPriority.INTERACTIVE);
      return;
    }

    // Fallback: no coordinator (e.g. in tests).  Use direct debounce.
    // Clear pending timer and reset — same behavior as the old per-root
    // debounce, ensuring the most recent commit wins.
    if (this.container.renderTimer !== null) {
      clearTimeout(this.container.renderTimer);
    }
    this.container.renderTimer = setTimeout(async () => {
      this.container.renderTimer = null;
      await this.doFlush();
    }, 17);
  }

  /** FlushableRoot implementation: called by the FlushCoordinator. */
  async executeFlush(): Promise<void> {
    await this.doFlush();
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
    this.flushCoordinator?.cancelFlush(this.flushId);
    this.eventBus.emit("willDisappear", undefined as never);
    getReconciler().updateContainer(null, this.fiberRoot, null, () => {});
    this.eventBus.removeAllListeners();
  }

  // ── Root Recycling ────────────────────────────────────────────
  //
  // suspend() + resume() enable root reuse across willDisappear →
  // willAppear cycles.  Instead of destroying and recreating the
  // fiber root (the most expensive React operation), the root is
  // suspended (timers cleared, events flushed) and later resumed
  // with new context data.
  //
  // The fiber tree stays alive during suspension — React does not
  // run unmount effects.  On resume, a new EventBus is created so
  // that useEvent hooks re-subscribe (the EventBusContext value
  // change triggers React's effect re-run).
  //
  // Invariant: resume() MUST be called with the SAME action UUID
  // and canvas type — different components or surface types require
  // a fresh root.  The RootRecyclingPool enforces this via its key.

  /** Action UUID for pool key computation. */
  get uuid(): string {
    return this.actionInfo.uuid;
  }

  /** Canvas type for pool key computation. */
  get canvasType(): string {
    return this.canvas.type;
  }

  /**
   * Suspend the root: stop rendering, clear timers, emit
   * willDisappear, and remove all event listeners.  The fiber root
   * and component tree stay alive for potential reuse via resume().
   */
  suspend(): void {
    this.disposed = true;

    // Cancel any pending flush/debounce
    if (this.container.renderTimer !== null) {
      clearTimeout(this.container.renderTimer);
      this.container.renderTimer = null;
    }
    this.flushCoordinator?.cancelFlush(this.flushId);

    // Notify listeners (useWillDisappear hooks fire here)
    this.eventBus.emit("willDisappear", undefined as never);

    // Clear all event subscriptions.  The EventBus instance itself
    // is discarded on resume() — a new one is created so that React
    // hooks re-subscribe via the changed EventBusContext value.
    this.eventBus.removeAllListeners();

    // Reset performance diagnostics
    this._renderCount = 0;
    this._lastRenderReport = 0;
    this.lastDataUri = null;
    this.suppressHardwarePush = false;
  }

  /**
   * Resume a previously suspended root with new context data.
   * Reuses the existing fiber root and component tree, avoiding
   * the cost of getReconciler().createContainer() and initial mount.
   *
   * A new EventBus is created to force useEvent hooks to
   * re-subscribe (the EventBusContext value change triggers React's
   * effect dependency check).
   */
  resume(
    actionInfo: ActionInfo,
    deviceInfo: DeviceInfo,
    canvas: CanvasInfo,
    settings: JsonObject,
    globalSettings: JsonObject,
    action: AdapterActionHandle,
    adapter: StreamDeckAdapter,
    onSettingsChange: (settings: JsonObject) => Promise<void>,
    onGlobalSettingsChange: (settings: JsonObject) => Promise<void>,
    flushCoordinator?: FlushCoordinator,
  ): void {
    // ── Restore lifecycle ───────────────────────────────────────
    this.disposed = false;

    // ── Reset render pipeline skip state ────────────────────────
    // After resume, the hardware state is unknown — the physical
    // key may show a different profile's image, a blank screen,
    // or stale content from a different action.  Reset the skip
    // hierarchy so the first post-resume flush runs the full
    // render pipeline and pushes to hardware unconditionally.
    //
    // Phase 1 (dirty check): setting _dirty=true forces past the
    //   O(1) isContainerDirty() guard.
    //
    // Phase 4 (FNV-1a output dedup): zeroing lastSvgHash ensures
    //   the rendered output won't match the stale pre-suspend hash,
    //   so the frame is always pushed to hardware.
    //
    // Phase 2 (Merkle hash → image cache) is intentionally NOT
    // reset — if the rendered tree matches a cached frame, returning
    // the cached data URI avoids a full Takumi re-render (~10-15ms)
    // while still pushing to hardware (which is the goal).
    this.container._dirty = true;
    this.container.lastSvgHash = 0;

    // ── Update identity ─────────────────────────────────────────
    this.actionInfo = actionInfo;
    this.deviceInfo = deviceInfo;
    this.canvas = canvas;
    this.action = action;
    this.adapter = adapter;
    this.flushId = actionInfo.id;
    this.flushCoordinator = flushCoordinator ?? null;

    // ── Swap callbacks ──────────────────────────────────────────
    // The setSettingsFn / setGlobalSettingsFn closures read from
    // these instance fields, so swapping them here is sufficient —
    // no need to recreate the closures.
    this._onSettingsChange = onSettingsChange;
    this._onGlobalSettingsChange = onGlobalSettingsChange;

    // ── Update settings ─────────────────────────────────────────
    this.settings = { ...settings };
    this.globalSettings = { ...globalSettings };

    // ── Rebuild context values ──────────────────────────────────
    // New object references so React detects context changes and
    // re-renders consumers.
    this.rootContextValue = {
      action: actionInfo,
      device: deviceInfo,
      canvas,
      streamDeck: { action, adapter },
    };
    this.settingsValue = { settings: this.settings, setSettings: this.setSettingsFn };
    this.globalSettingsValue = {
      settings: this.globalSettings,
      setSettings: this.setGlobalSettingsFn,
    };

    // ── New EventBus ────────────────────────────────────────────
    // Creating a new EventBus instance changes the EventBusContext
    // value, which forces React to re-run useEffect hooks that
    // subscribe to events (their `bus` dependency changes).
    // Without this, event handlers registered before suspend()
    // would not be re-created after resume().
    this.eventBus = new EventBus();
    this.eventBus.ownerId = actionInfo.id;
    this.eventBus.ownerUuid = actionInfo.uuid;

    // ── Re-apply encoder feedback layout ────────────────────────
    // The new SDK action handle needs its feedback layout configured
    // (same as initial mount in the constructor).
    if (canvas.type === "dial" || canvas.type === "touch") {
      const layout = this.resolvedDialLayout;
      this.action.setFeedbackLayout(
        typeof layout === "string" ? layout : (layout as unknown as Record<string, unknown>),
      );
    }

    // ── Re-render ───────────────────────────────────────────────
    // Reconcile the component tree with updated context values.
    // React diffs the new tree against the existing fiber tree —
    // same component, updated providers.  Much cheaper than a full
    // mount (fiber root creation + initial render).
    this.render();
  }
}

function resolveDialLayout(layout?: EncoderLayout): EncoderLayout {
  if (layout) return layout;

  return {
    ...DEFAULT_DIAL_LAYOUT,
    items: DEFAULT_DIAL_LAYOUT.items.map((item) => ({ ...item })),
  };
}
