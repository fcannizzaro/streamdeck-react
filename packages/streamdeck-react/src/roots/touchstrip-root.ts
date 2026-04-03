import { createElement, type ComponentType, type ReactElement } from "react";
import { reconciler } from "@/reconciler/renderer";
import {
  createVContainer,
  isContainerDirty,
  clearDirtyFlags,
  type VContainer,
} from "@/reconciler/vnode";
import { renderToRaw, sliceToDataUri, measureTree, type RenderConfig } from "@/render/pipeline";
import { fnv1a, computeTreeHash, computeTouchStripSegmentCacheKey } from "@/render/cache";
import { getTouchStripSegmentCache } from "@/render/image-cache";
import { EventBus } from "@/context/event-bus";
import {
  DeviceContext,
  EventBusContext,
  GlobalSettingsContext,
  type GlobalSettingsContextValue,
} from "@/context/providers";
import { TouchStripContext } from "@/context/touchstrip-context";
import type { DeviceInfo, TouchStripInfo, WrapperComponent } from "@/types";
import { partialHasChanges, shallowEqualSettings } from "./settings-equality";
import type { AdapterActionHandle } from "@/adapter/types";
import type { JsonObject } from "@elgato/utils";
import { FlushPriority, type FlushableRoot, type FlushCoordinator } from "./flush-coordinator";

// ── Constants ───────────────────────────────────────────────────────
// Stream Deck Plus encoders: each segment is 200×100 pixels.
// A full 4-encoder strip is 800×100.  Columns may not be contiguous
// (e.g. columns [0, 1, 3] if encoder 2 is used by a different action).

const SEGMENT_WIDTH = 200;
const SEGMENT_HEIGHT = 100;
const DEFAULT_TOUCH_STRIP_FPS = 30;

// ── Column Entry ────────────────────────────────────────────────────

interface ColumnEntry {
  actionId: string;
  sdkAction: AdapterActionHandle;
}

// ── Touch Strip Root ────────────────────────────────────────────────
//
// Shared React fiber root that renders ONE component tree spanning
// the full touch strip width.  Unlike ReactRoot (one per key/dial),
// there is one TouchStripRoot per device, shared by all encoder actions
// on that device.
//
// Architecture:
//
//   TouchStripRoot (one per device, e.g. Stream Deck Plus)
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
// Rendering path:
//
//   Single full-width Takumi render → raw RGBA → cropSlice per segment
//   → sync PNG encode → data URI → setFeedback per encoder.
//
//   1 Takumi render (~10-15ms) + N cheap CPU crops (~0.5ms each) +
//   N sync PNG encodes (~1-3ms each) = ~15-27ms total for 4 segments.
//
// Flush scheduling:
//   Stream Deck hardware refreshes at max 30Hz.  The 17ms debounce
//   (half-period of 33ms tick interval) coalesces high-frequency
//   state updates.  Each flush independently resolves via setTimeout;
//   the Phase 1 dirty check skips redundant renders in O(1).
//
// Skip hierarchy:
//
//   Phase 1: Dirty-flag check (O(1))
//     └─ skip if no VNode mutated since last flush
//
//   Phase 2: Tree hash → segment URI cache (LRU)
//     └─ skip render + crop + encode if tree hash matches a cached frame
//     └─ computeTreeHash is incremental (per-node Merkle hashes)
//
//   Phase 3: FNV-1a output dedup
//     └─ skip hardware push if output identical to last frame
//
// Columns are dynamic — encoders appear/disappear as the user drags
// actions onto the Stream Deck.  The geometry is recomputed via
// updateTouchStripInfo() whenever a column is added or removed.

export class TouchStripRoot implements FlushableRoot {
  readonly eventBus = new EventBus();
  private container: VContainer;
  private fiberRoot: ReturnType<typeof reconciler.createContainer>;
  private columns = new Map<number, ColumnEntry>();
  private globalSettings: JsonObject;
  private setGlobalSettingsFn: (partial: JsonObject) => void;
  private renderConfig: RenderConfig;
  private deviceInfo: DeviceInfo;
  private disposed = false;
  private pluginWrapper?: WrapperComponent;
  private flushCoordinator: FlushCoordinator | null;

  // ── FlushableRoot interface ───────────────────────────────────
  readonly flushId: string;

  // Stream Deck hardware refreshes at max 30Hz.  Half-period debounce
  // (17ms) fires at the midpoint between ticks, coalescing high-frequency
  // state updates without adding perceptible latency.
  private readonly renderDebounceMs = 17;

  // ── Performance diagnostics ───────────────────────────────────
  private _renderCount = 0;
  private _lastRenderReport = 0;
  private static readonly RENDER_WARN_THRESHOLD = 35;

  // ── Phase 3 output dedup ──────────────────────────────────────
  // Separate hash field for the TouchStrip-level segment URI dedup.
  // Must NOT share container.lastSvgHash — renderToRaw's Phase 4
  // writes raw RGBA buffer hashes (xxHash/FNV-1a over ~320 KB), while
  // this Phase 3 writes segment URI string hashes (FNV-1a over URI
  // concatenation).  Sharing the field causes cross-domain comparisons
  // where a raw-buffer hash is compared against a URI hash, leading to
  // sporadic false-positive dedup skips (one every ~2^32 frames on
  // average, but correlated inputs may trigger it sooner).
  private _lastSegmentUriHash = 0;

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
  private touchStripValue: TouchStripInfo;

  constructor(
    private component: ComponentType,
    deviceInfo: DeviceInfo,
    initialGlobalSettings: JsonObject,
    renderConfig: RenderConfig,
    onGlobalSettingsChange: (settings: JsonObject) => Promise<void>,
    pluginWrapper?: WrapperComponent,
    flushCoordinator?: FlushCoordinator,
  ) {
    this.deviceInfo = deviceInfo;
    this.globalSettings = { ...initialGlobalSettings };
    this.renderConfig = renderConfig;
    this.pluginWrapper = pluginWrapper;
    this.flushCoordinator = flushCoordinator ?? null;
    this.flushId = `touchStrip:${deviceInfo.id}`;

    // Global settings mutator
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

    // Initial context values
    this.globalSettingsValue = {
      settings: this.globalSettings,
      setSettings: this.setGlobalSettingsFn,
    };

    this.touchStripValue = {
      width: 0,
      height: SEGMENT_HEIGHT,
      columns: [],
      segmentWidth: SEGMENT_WIDTH,
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
        console.error("[@fcannizzaro/streamdeck-react] TouchStrip uncaught error:", err);
      },
      (err: Error) => {
        console.error("[@fcannizzaro/streamdeck-react] TouchStrip caught error:", err);
      },
      (err: Error) => {
        console.error("[@fcannizzaro/streamdeck-react] TouchStrip recoverable error:", err);
      },
      () => {}, // onDefaultTransitionIndicator
    );

    // Set eventBus owner for devtools observer
    this.eventBus.ownerId = `touchStrip:${deviceInfo.id}`;
  }

  // ── Column Management ─────────────────────────────────────────

  addColumn(column: number, actionId: string, sdkAction: AdapterActionHandle): void {
    this.columns.set(column, { actionId, sdkAction });

    // The manifest's encoder layout (e.g. "$A0") provides the canvas pixmap.
    // No setFeedbackLayout call needed — it can conflict with the manifest layout.

    // Recompute geometry and render
    this.updateTouchStripInfo();
    this.scheduleRerender();
  }

  removeColumn(column: number): void {
    this.columns.delete(column);

    if (this.columns.size === 0) {
      // Will be cleaned up by the registry
      return;
    }

    this.updateTouchStripInfo();
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

  // ── Touch Strip Info ─────────────────────────────────────────

  private updateTouchStripInfo(): void {
    const sortedColumns = [...this.columns.keys()].sort((a, b) => a - b);
    const maxCol = sortedColumns.length > 0 ? sortedColumns[sortedColumns.length - 1]! + 1 : 0;

    this.touchStripValue = {
      width: maxCol * SEGMENT_WIDTH,
      height: SEGMENT_HEIGHT,
      columns: sortedColumns,
      segmentWidth: SEGMENT_WIDTH,
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
      TouchStripContext.Provider,
      { value: this.touchStripValue },
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

  // ── Flush: VNode → raw RGBA → buffer crop → setFeedback ──────

  private async flush(): Promise<void> {
    if (this.disposed) return;

    // Delegate to the FlushCoordinator for batched, priority-ordered
    // processing when available.
    if (this.flushCoordinator) {
      this.flushCoordinator.requestFlush(this, FlushPriority.INTERACTIVE);
      return;
    }

    // Fallback: no coordinator (e.g. in tests).
    // No clearTimeout — let every scheduled render fire independently.
    // If a previous timer already rendered this tree state, doFlush's
    // Phase 1 dirty check (isContainerDirty) returns false and skips
    // in O(1).  This avoids the anti-pattern where a new flush()
    // cancels a pending render, delaying the frame.
    if (this.renderDebounceMs > 0) {
      this.container.renderTimer = setTimeout(async () => {
        this.container.renderTimer = null;
        await this.doFlush();
      }, this.renderDebounceMs);
    } else {
      await this.doFlush();
    }
  }

  /** FlushableRoot implementation: called by the FlushCoordinator. */
  async executeFlush(): Promise<void> {
    await this.doFlush();
  }

  private async doFlush(): Promise<void> {
    if (this.disposed || this.columns.size === 0) return;

    if (this.renderConfig.debug) {
      this._renderCount++;
      const now = Date.now();
      if (now - this._lastRenderReport > 1000) {
        if (this._renderCount > TouchStripRoot.RENDER_WARN_THRESHOLD) {
          console.warn(
            `[@fcannizzaro/streamdeck-react] TouchStrip rendered ${this._renderCount}x in 1s (max ${DEFAULT_TOUCH_STRIP_FPS}fps)`,
          );
        }
        this._renderCount = 0;
        this._lastRenderReport = now;
      }
    }

    try {
      const width = this.touchStripValue.width;
      if (width === 0) return;

      // ── Phase 1: Dirty-flag check ─────────────────────────────
      // If no VNode was mutated since last flush, skip entirely.
      // Cost: O(1) — just a boolean check on the container.
      if (this.renderConfig.caching && !isContainerDirty(this.container)) {
        return;
      }

      // ── Phase 2: Segment URI cache ────────────────────────────
      // Compute incremental Merkle hash of the VNode tree and look
      // up in the byte-bounded LRU cache.  On hit, push cached
      // segment URIs directly — skipping the entire render + crop +
      // encode pipeline (~16-29ms saved per cached frame).
      //
      // computeTreeHash is incremental: per-node hashes are cached
      // via _hashValid, so only the dirty path is re-hashed.  Cost
      // is O(dirty-path-depth), not O(total-nodes).
      //
      // For looping animations (e.g. equalizer with wrapping frame
      // counter), every frame in the second cycle onwards is a cache
      // hit as long as parameters (speed, amplitude) haven't changed.
      const sortedColumns = [...this.columns.keys()].sort((a, b) => a - b);
      let cacheKey: number | undefined;
      const profiling = this.renderConfig.onProfile != null;
      const tPhase2 = profiling ? performance.now() : 0;

      if (this.renderConfig.caching && this.renderConfig.touchStripCacheMaxBytes > 0) {
        const treeHash = computeTreeHash(this.container);
        cacheKey = computeTouchStripSegmentCacheKey(
          treeHash,
          width,
          SEGMENT_HEIGHT,
          this.renderConfig.devicePixelRatio,
          sortedColumns,
        );
        const cache = getTouchStripSegmentCache(this.renderConfig.touchStripCacheMaxBytes);
        const cached = cache.get(cacheKey);

        if (cached !== undefined) {
          // Cache hit — push cached segment URIs directly.
          for (const [column, uri] of cached) {
            this.lastSegmentUris.set(column, uri);
          }

          if (!this.suppressHardwarePush) {
            for (const [column, uri] of cached) {
              const entry = this.columns.get(column);
              entry?.sdkAction.setFeedback({ canvas: uri }).catch(() => {});
            }
          }

          clearDirtyFlags(this.container);

          // Emit profile for devtools — marks this frame as a segment
          // URI cache hit so the Performance panel shows the "cache" badge.
          // The pipeline's renderToRaw was never called (the segment URI
          // cache sits above it in the skip hierarchy), so we must emit
          // the profile manually here.  Gated behind onProfile to avoid
          // measureTree overhead when devtools is not connected.
          if (profiling) {
            const tEnd = performance.now();
            const stats = measureTree(this.container.children);
            this.renderConfig.onProfile!({
              vnodeConversionMs: 0,
              takumiRenderMs: 0,
              hashMs: tEnd - tPhase2,
              base64Ms: 0,
              totalMs: tEnd - tPhase2,
              skipped: false,
              cacheHit: true,
              treeDepth: stats.depth,
              nodeCount: stats.count,
              cacheStats: null,
            });
          }

          this.renderConfig.onRender?.(this.container, "");
          return;
        }
      }

      // ── Cache miss — render, crop, encode ─────────────────────
      // Single Takumi render → raw RGBA pixels
      const result = await renderToRaw(this.container, width, SEGMENT_HEIGHT, this.renderConfig);

      if (result === null || this.disposed) return;

      // Crop each segment from the raw buffer.
      // Each sliceToDataUri call does a cheap CPU Buffer.copy() +
      // sync PNG encode (~1-3ms per segment).  No Takumi re-render.
      const segmentResults: Array<[number, string]> = [];
      for (const [column] of this.columns) {
        const sliceUri = sliceToDataUri(
          result.buffer,
          result.width,
          result.height,
          column,
          SEGMENT_WIDTH,
          SEGMENT_HEIGHT,
        );
        segmentResults.push([column, sliceUri]);
        this.lastSegmentUris.set(column, sliceUri);
      }

      // Sort for deterministic hashing and cache storage
      segmentResults.sort((a, b) => a[0] - b[0]);

      // ── Phase 3: FNV-1a output dedup ──────────────────────────
      // Hash the concatenated segment URIs.  If identical to the
      // previous frame, skip hardware push — the component re-rendered
      // but produced no visual change.
      //
      // Uses _lastSegmentUriHash (not container.lastSvgHash) to avoid
      // cross-domain hash comparison with renderToRaw's Phase 4.
      let skipped = false;
      if (this.renderConfig.caching) {
        const dedupInput = segmentResults.map(([col, uri]) => `${col}:${uri}`).join("\0");
        const uriHash = fnv1a(dedupInput);

        if (uriHash === this._lastSegmentUriHash) {
          skipped = true;
        } else {
          this._lastSegmentUriHash = uriHash;
        }
      }

      // Push to hardware (skipped if Phase 3 detected identical output)
      if (!skipped && !this.suppressHardwarePush) {
        for (const [column, uri] of segmentResults) {
          const entry = this.columns.get(column);
          entry?.sdkAction.setFeedback({ canvas: uri }).catch(() => {});
        }
      }

      // ── Store in segment URI cache ────────────────────────────
      if (
        cacheKey !== undefined &&
        this.renderConfig.caching &&
        this.renderConfig.touchStripCacheMaxBytes > 0
      ) {
        const cache = getTouchStripSegmentCache(this.renderConfig.touchStripCacheMaxBytes);
        // Estimate byte size: 64 bytes overhead + 2 bytes per char per URI + 16 per entry
        let byteSize = 64;
        for (const [, uri] of segmentResults) {
          byteSize += uri.length * 2 + 16;
        }
        cache.set(cacheKey, segmentResults, byteSize);
      }

      clearDirtyFlags(this.container);

      // ── Notify devtools of the TouchStrip render ──────────────
      //
      // The devtools bridge hooks into config.onRender to receive
      // render notifications.  For TouchStrip, there is no single
      // data URI (the output is per-segment), so we call onRender
      // here after all segments are processed.
      //
      // The bridge's onRender handler detects TouchStrip containers
      // by matching `container === tb.root.vcontainer` and delegates
      // to emitTouchStripRender(), which reads lastSegmentUris.
      this.renderConfig.onRender?.(this.container, "");
    } catch (err) {
      console.error("[@fcannizzaro/streamdeck-react] TouchStrip render error:", err);
    }
  }

  // ── External Updates ──────────────────────────────────────────

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
    reconciler.updateContainer(null, this.fiberRoot, null, () => {});
    this.eventBus.removeAllListeners();
    this.columns.clear();
  }
}
