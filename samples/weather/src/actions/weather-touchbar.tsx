// ── Weather TouchBar ───────────────────────────────────────────────
// Full-width touch strip component (800×100). Renders 12 mini weather
// cards (4 segments × 3 cards). Dial rotation moves a cursor highlight.
// Pressing a dial or tapping a card expands a detail overlay on the
// segment containing the selected card.

import { useState, useRef } from "react";
import {
  defineAction,
  useTouchBar,
  useTouchBarTap,
  useTouchBarDialRotate,
  useTouchBarDialDown,
  useTick,
  Icon,
  tw,
} from "@fcannizzaro/streamdeck-react";
import {
  useWeatherStore,
  getSegmentEntries,
  getForecastIndex,
  COLS_PER_SEGMENT,
  NUM_SEGMENTS,
} from "../store";
import { getWeatherIcon, ICON_THERMO_HIGH, ICON_THERMO_LOW } from "../icons";
import { getSubColBackground, getSubColShadow, DIAL_BACKGROUND } from "../theme";
import type { ForecastEntry } from "../types";

// ── Layout constants ───────────────────────────────────────────────

const STRIP_H = 100;
const SEGMENT_W = 200;
const GAP = 6;
const EDGE_PAD = GAP / 2; // 3px at each segment edge
const CARD_W = Math.floor(
  (SEGMENT_W - EDGE_PAD * 2 - GAP * (COLS_PER_SEGMENT - 1)) / COLS_PER_SEGMENT,
);
const CARD_H = STRIP_H - GAP; // top/bottom padding
const ANIM_SPEED = 5; // progress units per second

// ── Mini weather card ──────────────────────────────────────────────

function MiniCard({
  entry,
  isFocused,
  width,
}: {
  entry: ForecastEntry;
  isFocused: boolean;
  width: number;
}) {
  const bg = getSubColBackground(entry.isDay);
  const shadow = getSubColShadow(isFocused);
  const iconPath = getWeatherIcon(entry.weatherCode, entry.isDay);

  return (
    <div
      className={tw("flex flex-col items-center justify-center")}
      style={{
        width,
        height: CARD_H,
        backgroundColor: bg,
        borderRadius: 10,
        boxShadow: shadow,
        boxSizing: "border-box",
      }}
    >
      <Icon path={iconPath} size={20} color="rgba(255,255,255,0.9)" />
      <span className="text-[20px] font-bold text-white">{entry.temp}&deg;</span>
      <span className="text-[9px] font-medium text-white/80">{entry.label}</span>
    </div>
  );
}

// ── Empty card placeholder ─────────────────────────────────────────

function EmptyCard({ width }: { width: number }) {
  return (
    <div
      className={tw("flex flex-col items-center justify-center")}
      style={{
        width,
        height: CARD_H,
        backgroundColor: "rgba(255,255,255,0.05)",
        borderRadius: 10,
        border: "2px solid transparent",
      }}
    >
      <span className="text-[14px] text-white/20">--</span>
    </div>
  );
}

// ── Detail overlay panel ───────────────────────────────────────────
// Positioned on a single segment (200×100). Shows a big label watermark
// and two rows: MAX and MIN with icon + label on left, value on right.

function DetailPanel({
  entry,
  progress,
  segmentLeft,
}: {
  entry: ForecastEntry;
  progress: number;
  segmentLeft: number;
}) {
  const panelH = Math.round(STRIP_H * progress);
  const contentOpacity = Math.min(1, Math.max(0, (progress - 0.3) / 0.5));
  const bg = getSubColBackground(entry.isDay);

  return (
    <div
      style={{
        position: "absolute",
        left: segmentLeft,
        top: STRIP_H - panelH,
        width: SEGMENT_W,
        height: panelH,
        backgroundColor: bg,
        borderRadius: 10,
        overflow: "hidden",
        zIndex: 10,
      }}
    >
      {progress > 0.3 && (
        <div
          style={{
            width: SEGMENT_W,
            height: STRIP_H,
            position: "relative",
            opacity: contentOpacity,
          }}
        >
          {/* Big label watermark */}
          <span
            className="font-bold text-white/10"
            style={{
              position: "absolute",
              right: 4,
              top: -2,
              fontSize: 68,
              lineHeight: "1",
              letterSpacing: "-2px",
            }}
          >
            {entry.label}
          </span>

          {/* MAX / MIN rows — pushed toward bottom */}
          <div
            style={{
              position: "absolute",
              left: 10,
              right: 10,
              top: STRIP_H - 8 - 52,
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            {/* MAX row */}
            <div className={tw("flex items-center justify-between")}>
              <div className={tw("flex items-center gap-2")}>
                <Icon path={ICON_THERMO_HIGH} size={18} color="rgba(255,255,255,0.8)" />
                <span className="text-[14px] font-bold text-white/80">MAX</span>
              </div>
              <span className="text-[20px] font-bold text-white">{entry.tempMax}&deg;</span>
            </div>

            {/* MIN row */}
            <div className={tw("flex items-center justify-between")}>
              <div className={tw("flex items-center gap-2")}>
                <Icon path={ICON_THERMO_LOW} size={18} color="rgba(255,255,255,0.8)" />
                <span className="text-[14px] font-bold text-white/80">MIN</span>
              </div>
              <span className="text-[20px] font-bold text-white">{entry.tempMin}&deg;</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Segment renderer ───────────────────────────────────────────────
// Renders 3 cards for a single 200px segment of the touch strip.

function Segment({
  segment,
  forecast,
  scrollOffset,
  cursor,
}: {
  segment: number;
  forecast: ForecastEntry[];
  scrollOffset: number;
  cursor: number;
}) {
  const entries = getSegmentEntries(forecast, scrollOffset, segment);

  return (
    <div
      className={tw("flex items-center")}
      style={{
        width: SEGMENT_W,
        height: STRIP_H,
        paddingLeft: EDGE_PAD,
        paddingRight: EDGE_PAD,
        paddingTop: GAP / 2,
        paddingBottom: GAP / 2,
        gap: GAP + 0.5,
        flexShrink: 0,
      }}
    >
      {entries.map((entry, i) => {
        const forecastIdx = getForecastIndex(scrollOffset, segment, i);
        const isFocused = forecastIdx === cursor;

        if (!entry) {
          return <EmptyCard key={`empty-${segment}-${i}`} width={CARD_W} />;
        }

        return <MiniCard key={forecastIdx} entry={entry} isFocused={isFocused} width={CARD_W} />;
      })}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────

function WeatherTouchBar() {
  const { width, height } = useTouchBar();

  // Store state
  const forecast = useWeatherStore((s) => s.forecast);
  const scrollOffset = useWeatherStore((s) => s.scrollOffset);
  const cursor = useWeatherStore((s) => s.cursor);
  const expandedSegment = useWeatherStore((s) => s.expandedSegment);
  const isLoading = useWeatherStore((s) => s.isLoading && s.forecast.length === 0);

  // Which segment has the cursor
  const cursorSegment = Math.floor((cursor - scrollOffset) / COLS_PER_SEGMENT);

  // ── Local animation state ──────────────────────────────────────

  const [progress, setProgress] = useState(0);
  const targetRef = useRef(0);
  targetRef.current = expandedSegment !== null ? 1 : 0;

  const needsAnimation = Math.abs(progress - targetRef.current) > 0.005;

  useTick(
    (deltaMs) => {
      const target = targetRef.current;
      setProgress((current) => {
        const step = (deltaMs / 1000) * ANIM_SPEED;
        if (target > current) return Math.min(target, current + step);
        if (target < current) return Math.max(target, current - step);
        return current;
      });
    },
    needsAnimation ? 60 : false,
  );

  // ── TouchBar interactions ──────────────────────────────────────

  useTouchBarDialRotate(({ ticks }) => {
    const store = useWeatherStore.getState();
    if (store.expandedSegment !== null) {
      store.closeExpanded();
      return;
    }
    store.moveCursor(ticks);
  });

  useTouchBarDialDown(() => {
    const store = useWeatherStore.getState();

    // If any panel is expanded, close it
    if (store.expandedSegment !== null) {
      store.closeExpanded();
      return;
    }

    // Toggle detail panel for the cursor's segment
    store.toggleExpanded();
  });

  useTouchBarTap(({ tapPos }) => {
    const store = useWeatherStore.getState();

    // If detail is open, close it
    if (store.expandedSegment !== null) {
      store.closeExpanded();
      return;
    }

    // Determine which segment and sub-column was tapped
    const x = tapPos[0];
    const tappedSegment = Math.min(NUM_SEGMENTS - 1, Math.floor(x / SEGMENT_W));
    const localX = x - tappedSegment * SEGMENT_W;
    const subCol = Math.min(
      COLS_PER_SEGMENT - 1,
      Math.floor(localX / (SEGMENT_W / COLS_PER_SEGMENT)),
    );
    const forecastIdx = getForecastIndex(store.scrollOffset, tappedSegment, subCol);

    if (forecastIdx < store.forecast.length) {
      if (store.cursor !== forecastIdx) {
        useWeatherStore.setState({ cursor: forecastIdx });
      }
      store.toggleExpanded();
    }
  });

  // ── Loading / empty states ─────────────────────────────────────

  if (isLoading) {
    return (
      <div
        className={tw("flex items-center justify-center")}
        style={{ width, height, backgroundColor: DIAL_BACKGROUND }}
      >
        <span className="text-[13px] text-white/50">Loading...</span>
      </div>
    );
  }

  if (forecast.length === 0) {
    return (
      <div
        className={tw("flex items-center justify-center")}
        style={{ width, height, backgroundColor: DIAL_BACKGROUND }}
      >
        <span className="text-[13px] text-white/30">No data</span>
      </div>
    );
  }

  // ── Detail entry ───────────────────────────────────────────────

  const detailSubCol = cursor - (scrollOffset + cursorSegment * COLS_PER_SEGMENT);
  const detailEntries = getSegmentEntries(forecast, scrollOffset, cursorSegment);
  const detailEntry =
    detailSubCol >= 0 && detailSubCol < COLS_PER_SEGMENT
      ? detailEntries[detailSubCol]
      : undefined;

  const showPanel = progress > 0.005 && detailEntry;

  // Center the 200px panel on the selected card, clamped to the strip edges
  const activeSegment = expandedSegment ?? cursorSegment;
  const activeSubCol = cursor - (scrollOffset + activeSegment * COLS_PER_SEGMENT);
  const cardCenterX =
    activeSegment * SEGMENT_W +
    EDGE_PAD +
    activeSubCol * (CARD_W + GAP + 0.5) +
    CARD_W / 2;
  const panelLeft = Math.max(0, Math.min(width - SEGMENT_W, cardCenterX - SEGMENT_W / 2));

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div
      style={{
        width,
        height,
        backgroundColor: DIAL_BACKGROUND,
        position: "relative",
        overflow: "hidden",
        display: "flex",
      }}
    >
      {/* All segments side by side */}
      {Array.from({ length: NUM_SEGMENTS }, (_, seg) => (
        <Segment
          key={seg}
          segment={seg}
          forecast={forecast}
          scrollOffset={scrollOffset}
          cursor={cursor}
        />
      ))}

      {/* Dark backdrop behind the detail panel */}
      {expandedSegment !== null && (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width,
            height: STRIP_H,
            backgroundColor: "rgba(0,0,0,0.5)",
            zIndex: 5,
          }}
        />
      )}

      {/* Detail overlay (animated from bottom) */}
      {showPanel && (
        <DetailPanel
          entry={detailEntry}
          progress={progress}
          segmentLeft={panelLeft}
        />
      )}
    </div>
  );
}

// ── Action definition ──────────────────────────────────────────────

export const weatherAction = defineAction({
  uuid: "com.example.react-weather.forecast",
  touchBar: WeatherTouchBar,
  touchBarFPS: 60,
});
