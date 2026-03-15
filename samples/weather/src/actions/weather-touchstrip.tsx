// ── Weather TouchStrip ─────────────────────────────────────────────
// Full-width touch strip component (800×100). Renders a flat row of
// mini weather cards. Dial rotation moves a cursor highlight.
// Pressing a dial or tapping a card expands a detail overlay
// centered on the selected card.

import { useEffect, useRef } from "react";
import {
  defineAction,
  useTouchStrip,
  useTouchStripTap,
  useTouchStripDialRotate,
  useTouchStripDialDown,
  useSpring,
  SpringPresets,
  Icon,
  tw,
} from "@fcannizzaro/streamdeck-react";
import { useWeatherStore, CARDS_PER_SEGMENT } from "../store";
import { getWeatherIcon, WeatherIcon, ICON_THERMO_HIGH, ICON_THERMO_LOW } from "../icons";
import { getSubColBackground, getSubColShadow, DIAL_BACKGROUND } from "../theme";
import type { ForecastEntry } from "../types";

// ── Layout constants ───────────────────────────────────────────────

const STRIP_H = 100;
const CARD_GAP = 5;
const EDGE_PAD = 3;
const CARD_V_PAD = 3; // top/bottom padding
const DETAIL_PANEL_W = 200;

/** Compute card width from the available strip width. */
function computeCardWidth(stripWidth: number, totalVisible: number): number {
  return Math.floor((stripWidth - EDGE_PAD * 2 - CARD_GAP * (totalVisible - 1)) / totalVisible);
}

/** Compute the x-center of a card at the given visible index. */
function cardCenterX(visibleIndex: number, cardW: number): number {
  return EDGE_PAD + visibleIndex * (cardW + CARD_GAP) + cardW / 2;
}

// ── Mini weather card ──────────────────────────────────────────────

function MiniCard({
  entry,
  isFocused,
  width,
  height,
}: {
  entry: ForecastEntry;
  isFocused: boolean;
  width: number;
  height: number;
}) {
  // Bounce on focus: instantly dip the card down, then let the wobbly
  // spring pull it back to 0. The overshoot makes the card briefly
  // overshoot upward before settling — a satisfying little bounce.
  const { value: offsetY, jump, set } = useSpring<number>(0, SpringPresets.wobbly);

  const wasFocused = useRef(isFocused);
  useEffect(() => {
    if (isFocused && !wasFocused.current) {
      jump(12);
      set(0);
    }
    wasFocused.current = isFocused;
  }, [isFocused, jump, set]);

  const bg = getSubColBackground(entry.isDay);
  const shadow = getSubColShadow(isFocused);
  const icon = getWeatherIcon(entry.weatherCode, entry.isDay);

  return (
    <div
      className={tw("flex flex-col items-center justify-center")}
      style={{
        width,
        height,
        marginTop: Math.round(offsetY),
        backgroundColor: bg,
        borderRadius: 10,
        boxShadow: shadow,
        boxSizing: "border-box",
        flexShrink: 0,
        gap: 2,
      }}
    >
      <WeatherIcon icon={icon} size={28} />
      <span className="text-[20px] font-bold text-white">{entry.temp}&deg;</span>
      <span className="text-[9px] font-medium text-white/80">{entry.label}</span>
    </div>
  );
}

// ── Empty card placeholder ─────────────────────────────────────────

function EmptyCard({ width, height }: { width: number; height: number }) {
  return (
    <div
      className={tw("flex flex-col items-center justify-center")}
      style={{
        width,
        height,
        backgroundColor: "rgba(255,255,255,0.05)",
        borderRadius: 10,
        flexShrink: 0,
      }}
    >
      <span className="text-[14px] text-white/20">--</span>
    </div>
  );
}

// ── Detail overlay panel ───────────────────────────────────────────
// Shows a big label watermark and MAX/MIN rows, animated from the bottom.

function DetailPanel({
  entry,
  progress,
  left,
}: {
  entry: ForecastEntry;
  progress: number;
  left: number;
}) {
  const panelH = Math.round(STRIP_H * progress);
  const contentOpacity = Math.min(1, Math.max(0, (progress - 0.3) / 0.5));
  const bg = getSubColBackground(entry.isDay);

  return (
    <div
      style={{
        position: "absolute",
        left,
        top: STRIP_H - panelH,
        width: DETAIL_PANEL_W,
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
            width: DETAIL_PANEL_W,
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

          {/* MAX / MIN rows */}
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
            <div className={tw("flex items-center justify-between")}>
              <div className={tw("flex items-center gap-2")}>
                <Icon path={ICON_THERMO_HIGH} size={18} color="rgba(255,255,255,0.8)" />
                <span className="text-[14px] font-bold text-white/80">MAX</span>
              </div>
              <span className="text-[20px] font-bold text-white">{entry.tempMax}&deg;</span>
            </div>

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

// ── Main component ─────────────────────────────────────────────────

function WeatherTouchStrip() {
  const { width, height, columns } = useTouchStrip();

  // Sync segment count into the store when columns change
  const segmentCount = columns.length;
  useEffect(() => {
    useWeatherStore.getState().setSegmentCount(segmentCount);
  }, [segmentCount]);

  // Store state
  const forecast = useWeatherStore((s) => s.forecast);
  const scrollOffset = useWeatherStore((s) => s.scrollOffset);
  const cursor = useWeatherStore((s) => s.cursor);
  const expanded = useWeatherStore((s) => s.expanded);
  const totalVisible = useWeatherStore((s) => s.totalVisible);
  const isLoading = useWeatherStore((s) => s.isLoading && s.forecast.length === 0);

  // Layout
  const cardW = computeCardWidth(width, totalVisible);
  const cardH = STRIP_H - CARD_V_PAD * 2;

  // ── Spring-animated detail panel progress ───────────────────────

  const { value: progress } = useSpring(expanded ? 1 : 0, SpringPresets.stiff);

  // ── TouchStrip interactions ────────────────────────────────────

  useTouchStripDialRotate(({ ticks }) => {
    const store = useWeatherStore.getState();
    if (store.expanded) {
      store.closeExpanded();
      return;
    }
    store.moveCursor(ticks);
  });

  useTouchStripDialDown(() => {
    const store = useWeatherStore.getState();
    if (store.expanded) {
      store.closeExpanded();
      return;
    }
    store.toggleExpanded();
  });

  useTouchStripTap(({ tapPos }) => {
    const store = useWeatherStore.getState();

    if (store.expanded) {
      store.closeExpanded();
      return;
    }

    // Determine which card was tapped
    const x = tapPos[0];
    const tappedCol = Math.floor((x - EDGE_PAD) / (cardW + CARD_GAP));
    const tappedIdx = store.scrollOffset + Math.min(totalVisible - 1, Math.max(0, tappedCol));

    if (tappedIdx < store.forecast.length) {
      if (store.cursor !== tappedIdx) {
        useWeatherStore.setState({ cursor: tappedIdx });
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

  // ── Detail panel position ─────────────────────────────────────

  const cursorLocalIdx = cursor - scrollOffset;
  const detailEntry = forecast[cursor];
  const showPanel = progress > 0.005 && detailEntry;

  const panelCenterX = cardCenterX(cursorLocalIdx, cardW);
  const panelLeft = Math.max(
    0,
    Math.min(width - DETAIL_PANEL_W, panelCenterX - DETAIL_PANEL_W / 2),
  );

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
        alignItems: "center",
        paddingLeft: EDGE_PAD,
        paddingRight: EDGE_PAD,
        gap: CARD_GAP,
      }}
    >
      {/* Flat row of cards */}
      {Array.from({ length: totalVisible }, (_, i) => {
        const idx = scrollOffset + i;
        const entry = forecast[idx];
        const isFocused = idx === cursor;

        if (!entry) {
          return <EmptyCard key={`empty-${i}`} width={cardW} height={cardH} />;
        }

        return (
          <MiniCard key={idx} entry={entry} isFocused={isFocused} width={cardW} height={cardH} />
        );
      })}

      {/* Dark backdrop behind the detail panel */}
      {expanded && (
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
      {showPanel && <DetailPanel entry={detailEntry} progress={progress} left={panelLeft} />}
    </div>
  );
}

// ── Action definition ──────────────────────────────────────────────

export const weatherAction = defineAction({
  uuid: "com.example.react-weather.forecast",
  touchStrip: WeatherTouchStrip,
  info: {
    name: "Weather Forecast",
    icon: "imgs/actions/weather",
    tooltip:
      "Shows weather forecast on the touch strip. Rotate to scroll, press to expand details, tap to select.",
    encoder: {
      layout: "layouts/touchstrip.json",
      triggerDescription: {
        rotate: "Scroll forecast",
        push: "Toggle details",
        touch: "Select forecast",
      },
    },
  },
});
