import { createElement, type ComponentType, type ReactElement } from "react";
import { reconciler } from "@/reconciler/renderer";
import { createVContainer, type VContainer } from "@/reconciler/vnode";
import {
  renderToRaw,
  sliceToDataUriAsync,
  renderSegmentToDataUri,
  measureTree,
  type RenderConfig,
  type RenderProfile,
} from "@/render/pipeline";
import { metrics } from "@/render/metrics";
import { getImageCache } from "@/render/image-cache";
import { EventBus } from "@/context/event-bus";
import {
  DeviceContext,
  EventBusContext,
  GlobalSettingsContext,
  type GlobalSettingsContextValue,
} from "@/context/providers";
import { TouchBarContext } from "@/context/touchbar-context";
import type { DeviceInfo, EncoderLayout, TouchBarInfo, WrapperComponent } from "@/types";
import type { FlushCoordinator, FlushableRoot } from "./flush-coordinator";
import type { DialAction } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

// ── Constants ───────────────────────────────────────────────────────
// Stream Deck Plus encoders: each segment is 200×100 pixels.
// A full 4-encoder strip is 800×100.  Columns may not be contiguous
// (e.g. columns [0, 1, 3] if encoder 2 is used by a different action).

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
//
// Shared React fiber root that renders ONE component tree spanning
// the full touch strip width.  Unlike ReactRoot (one per key/dial),
// there is one TouchBarRoot per device, shared by all encoder actions
// on that device.
//
// Architecture:
//
//   TouchBarRoot (one per device, e.g. Stream Deck Plus)
//   ┌──────────────────────────────────────────────────┐
//   │ Single React tree renders at full width (800×100) │
//   │                                                  │
//   │  col 0      col 1      col 2      col 3          │
//   │ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐     │
//   │ │ 200×100│ │ 200×100│ │ 200×100│ │ 200×100│     │
//   │ └───┬────┘ └───┬────┘ └───┬────┘ └───┬────┘     │
//   │     │          │          │          │           │
//   │     ▼          ▼          ▼          ▼           │
//   │  setFeedback per encoder (sliced segments)       │
//   └──────────────────────────────────────────────────┘
//
// Two rendering paths (selected by touchbarImageFormat config):
//
//   Path A: Native format (WebP/PNG via Takumi)
//     Each segment rendered independently with CSS viewport offset.
//     Faster when Takumi's native encoder (WebP) is available.
//     See renderSegmentToDataUri() in pipeline.ts.
//
//   Path B: Raw → crop → PNG encode
//     Single full-width render → raw RGBA → cropSlice per segment
//     → encodePngAsync (parallel deflate via libuv thread pool).
//     Used when touchbarImageFormat is "png".
//
// Columns are dynamic — encoders appear/disappear as the user drags
// actions onto the Stream Deck.  The geometry is recomputed via
// updateTouchBarInfo() whenever a column is added or removed.

export class TouchBarRoot implements FlushableRoot {
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

  // ── Performance diagnostics ───────────────────────────────────
  private _renderCount = 0;
  private _lastRenderReport = 0;
  private static readonly RENDER_WARN_THRESHOLD = 65;

  // ── Frame skipping ────────────────────────────────────────────
  private _rendering = false;
  private _pendingFlush = false;

  // ── Adaptive debounce ─────────────────────────────────────────
  private _recentRenders: number[] = [];
  private _lastInteraction = 0;
  private static readonly ANIMATION_WINDOW_MS = 100;
  private static readonly ANIMATION_THRESHOLD = 2;
  private static readonly INTERACTION_COOLDOWN_MS = 500;

  // ── Render Priority ───────────────────────────────────────────
  private static readonly IDLE_THRESHOLD_MS = 2000;
  private _lastFlushTime = 0;

  /** Current render priority (lower = higher priority). Used by flush coordinator. */
  get priority(): number {
    const now = Date.now();
    const cutoff = now - TouchBarRoot.ANIMATION_WINDOW_MS;
    while (this._recentRenders.length > 0 && this._recentRenders[0]! < cutoff) {
      this._recentRenders.shift();
    }
    if (this._recentRenders.length > TouchBarRoot.ANIMATION_THRESHOLD) {
      return 0;
    }
    if (now - this._lastInteraction < TouchBarRoot.INTERACTION_COOLDOWN_MS) {
      return 1;
    }
    if (this._lastFlushTime > 0 && now - this._lastFlushTime > TouchBarRoot.IDLE_THRESHOLD_MS) {
      return 3;
    }
    return 2;
  }

  /** Last rendered per-column data URIs. Used by devtools snapshots. */
  lastSegmentUris = new Map<number, string>();

  /**
   * When true, doFlush skips pushing rendered segments to hardware.
   * Set by the devtools bridge while a highlight overlay is active so
   * that rapid re-renders don't overwrite the highlight on the device.
   * The highlight path calls pushSegmentImages() directly (bypassing
   * this flag).
   *
   * Mirrors ReactRoot.suppressHardwarePush — same pattern, different
   * granularity (per-segment instead of single image).
   */
  suppressHardwarePush = false;

  /**
   * Push per-column data URIs to the physical Stream Deck touch strip.
   * Used by the devtools highlight overlay to bypass suppressHardwarePush.
   *
   * @param uris  Map of column → data URI to push to hardware.
   *              Columns not present in the map are left unchanged.
   */
  async pushSegmentImages(uris: Map<number, string>): Promise<void> {
    if (this.disposed) return;
    const promises: Promise<void>[] = [];
    for (const [column, uri] of uris) {
      const entry = this.columns.get(column);
      if (entry) {
        promises.push(entry.sdkAction.setFeedback({ canvas: uri }).catch(() => {}));
      }
    }
    await Promise.all(promises);
  }

  /** Exposes the VContainer for devtools inspection. */
  get vcontainer(): VContainer {
    return this.container;
  }

  /** Sorted column numbers for devtools observer. */
  get columnNumbers(): number[] {
    return [...this.columns.keys()].sort((a, b) => a - b);
  }

  /** Column → actionId map for devtools observer. */
  get columnActionMap(): Map<number, string> {
    const map = new Map<number, string>();
    for (const [col, entry] of this.columns) {
      map.set(col, entry.actionId);
    }
    return map;
  }

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
    private flushCoordinator?: FlushCoordinator,
  ) {
    this.deviceInfo = deviceInfo;
    this.globalSettings = { ...initialGlobalSettings };
    this.renderConfig = renderConfig;
    this.fps = touchBarFPS ?? DEFAULT_TOUCHBAR_FPS;
    // When touchBarFPS is explicitly set, derive debounce from it;
    // otherwise fall back to the global renderDebounceMs.
    this.renderDebounceMs =
      touchBarFPS != null ? Math.max(1, Math.round(1000 / touchBarFPS)) : renderDebounceMs;
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

    // Set eventBus owner for devtools observer
    this.eventBus.ownerId = `touchbar:${deviceInfo.id}`;
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
    const maxCol = sortedColumns.length > 0 ? sortedColumns[sortedColumns.length - 1]! + 1 : 0;

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
          createElement(GlobalSettingsContext.Provider, { value: this.globalSettingsValue }, child),
        ),
      ),
    );
  }

  private scheduleRerender(): void {
    if (this.disposed) return;
    this.render();
  }

  // ── Flush: VNode → raw RGBA → buffer crop → setFeedback ────────

  /** Record a user interaction for adaptive debounce. */
  markInteraction(): void {
    this._lastInteraction = Date.now();
  }

  private get effectiveDebounceMs(): number {
    const now = Date.now();
    const cutoff = now - TouchBarRoot.ANIMATION_WINDOW_MS;
    while (this._recentRenders.length > 0 && this._recentRenders[0]! < cutoff) {
      this._recentRenders.shift();
    }
    if (this._recentRenders.length > TouchBarRoot.ANIMATION_THRESHOLD) {
      return 0;
    }
    if (now - this._lastInteraction < TouchBarRoot.INTERACTION_COOLDOWN_MS) {
      return Math.min(this.renderDebounceMs, 16);
    }
    return this.renderDebounceMs;
  }

  private async flush(): Promise<void> {
    if (this.disposed) return;

    // Frame skipping: if a render is in progress, just mark pending
    if (this._rendering) {
      this._pendingFlush = true;
      return;
    }

    this._recentRenders.push(Date.now());
    const debounce = this.effectiveDebounceMs;

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
    if (this.disposed || this.columns.size === 0) return;

    this._rendering = true;
    this._pendingFlush = false;
    this._lastFlushTime = Date.now();

    // Performance diagnostics: render frequency counter
    if (this.renderConfig.debug) {
      this._renderCount++;
      const now = Date.now();
      if (now - this._lastRenderReport > 1000) {
        if (this._renderCount > TouchBarRoot.RENDER_WARN_THRESHOLD) {
          console.warn(
            `[@fcannizzaro/streamdeck-react] TouchBar rendered ${this._renderCount}x in 1s (FPS target: ${this.fps})`,
          );
        }
        this._renderCount = 0;
        this._lastRenderReport = now;
      }
    }

    try {
      const width = this.touchBarValue.width;
      if (width === 0) return;

      const useNativeFormat = this.renderConfig.touchbarImageFormat !== "png";

      if (useNativeFormat) {
        // ── Direct per-segment rendering via Takumi (WebP/PNG) ──────
        // Each segment is rendered independently using Takumi's native
        // format output. Eliminates the raw→crop→deflate path entirely.
        //
        // Profiling: we wrap the entire segment batch with timing and
        // emit a single aggregate RenderProfile + metrics.  Individual
        // segment renders inside renderSegmentToDataUri() are not
        // profiled separately — the overhead of N profile emissions
        // (one per segment per frame) is not worth the granularity for
        // a 200×100 strip that renders as a unit.
        //
        //   doFlush() ── useNativeFormat path
        //     │
        //     ├─ metrics.recordFlush()
        //     ├─ t0 = performance.now()
        //     │
        //     ├─ Promise.all([
        //     │    renderSegmentToDataUri(col 0),
        //     │    renderSegmentToDataUri(col 1),
        //     │    ...
        //     │  ])
        //     │
        //     ├─ tEnd = performance.now()
        //     ├─ metrics.recordRender(elapsed)
        //     ├─ config.onProfile(aggregate)  ← stashes in bridge
        //     │
        //     └─ config.onRender(container, "")  ← bridge consumes profile

        metrics.recordFlush();

        const t0 = performance.now();

        const feedbackPromises = [...this.columns.entries()].map(async ([column, entry]) => {
          const sliceUri = await renderSegmentToDataUri(
            this.container,
            width,
            SEGMENT_HEIGHT,
            column,
            SEGMENT_WIDTH,
            this.renderConfig.touchbarImageFormat,
            this.renderConfig,
          );
          if (sliceUri != null) {
            this.lastSegmentUris.set(column, sliceUri);
            // Double buffering: fire-and-forget hardware push.
            // Guarded by suppressHardwarePush — when a devtools
            // highlight is active, normal renders must not
            // overwrite the overlay on the physical device.
            if (!this.suppressHardwarePush) {
              entry.sdkAction.setFeedback({ canvas: sliceUri }).catch(() => {});
            }
          }
        });
        await Promise.all(feedbackPromises);

        const tEnd = performance.now();
        const elapsedMs = tEnd - t0;
        metrics.recordRender(elapsedMs);

        // Emit an aggregate profile covering all segments.
        // The native-format path bypasses JSX→fromJsx conversion,
        // hash-based caching, and manual base64 encoding (Takumi
        // handles format encoding internally), so those stage
        // timings are zero.  The entire elapsed time is attributed
        // to takumiRenderMs since that's where the work happens.
        if (this.renderConfig.onProfile) {
          const stats = measureTree(this.container.children);
          const cache =
            this.renderConfig.imageCacheMaxBytes > 0
              ? getImageCache(this.renderConfig.imageCacheMaxBytes)
              : null;
          const profile: RenderProfile = {
            vnodeToElementMs: 0,
            fromJsxMs: 0,
            takumiRenderMs: elapsedMs,
            hashMs: 0,
            base64Ms: 0,
            totalMs: elapsedMs,
            skipped: false,
            cacheHit: false,
            treeDepth: stats.depth,
            nodeCount: stats.count,
            cacheStats: cache?.stats ?? null,
          };
          this.renderConfig.onProfile(profile);
        }
      } else {
        // ── Raw render + crop + PNG encode path ─────────────────────
        // Single Takumi render → raw RGBA pixels → crop → PNG encode
        const result = await renderToRaw(this.container, width, SEGMENT_HEIGHT, this.renderConfig);

        if (result === null || this.disposed) return;

        // Crop and encode each segment in parallel (async deflate via libuv thread pool)
        const feedbackPromises = [...this.columns.entries()].map(async ([column, entry]) => {
          const sliceUri = await sliceToDataUriAsync(
            result.buffer,
            result.width,
            result.height,
            column,
            SEGMENT_WIDTH,
            SEGMENT_HEIGHT,
          );
          this.lastSegmentUris.set(column, sliceUri);
          // Double buffering: fire-and-forget hardware push.
          // Guarded by suppressHardwarePush — see WebP path above.
          if (!this.suppressHardwarePush) {
            entry.sdkAction.setFeedback({ canvas: sliceUri }).catch(() => {});
          }
        });
        await Promise.all(feedbackPromises);
      }

      // ── Notify devtools of the touchbar render ──────────────────
      //
      // The devtools bridge hooks into config.onRender to receive
      // render notifications.  For key/dial actions, renderToDataUri()
      // calls onRender internally with the data URI.  For touchbar,
      // there is no single data URI (the output is per-segment), so
      // we call onRender here after all segments are processed.
      //
      // The bridge's onRender handler detects touchbar containers by
      // matching `container === tb.root.vcontainer` and delegates to
      // emitTouchBarRender(), which reads lastSegmentUris directly.
      // The empty-string dataUri is intentional — it's unused for
      // touchbar; the bridge reads segment URIs from the root.
      //
      //   doFlush() ──onRender(container, "")──→  bridge.onRender()
      //                                              │
      //                    matches touchbar root ◄───┘
      //                                              │
      //                                              ▼
      //                                   emitTouchBarRender()
      //                                      reads lastSegmentUris
      //                                              │
      //                                              ▼
      //                                   SSE "render:touchbar"
      //                                      → Performance Panel
      //
      // onProfile fires synchronously inside renderToRaw() /
      // renderSegmentToDataUri() BEFORE we reach this point, so
      // the bridge's _lastProfile stash is populated and will be
      // consumed by emitTouchBarRender().
      this.renderConfig.onRender?.(this.container, "");
    } catch (err) {
      console.error("[@fcannizzaro/streamdeck-react] TouchBar render error:", err);
    } finally {
      this._rendering = false;

      // If a flush was requested while we were rendering, drain it now
      if (this._pendingFlush && !this.disposed) {
        this._pendingFlush = false;
        await this.doFlush();
      }
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
