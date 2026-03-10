// ── Weather Dial ───────────────────────────────────────────────────
// Per-encoder dial component (200x100). Renders 3 mini weather cards
// side by side. Dial rotation moves a cursor highlight between them.
// Pressing the dial or tapping a card expands a detail overlay that
// animates up from the bottom.

import { useState, useRef } from "react";
import {
  defineAction,
  useAction,
  useDialRotate,
  useDialDown,
  useDialUp,
  useDialHint,
  useTouchTap,
  useTick,
  useWillAppear,
  useWillDisappear,
  Icon,
  tw,
} from "@fcannizzaro/streamdeck-react";
import { useWeatherStore, getDialEntries, getForecastIndex, COLS_PER_DIAL } from "../store";
import { getWeatherIcon, ICON_THERMO_HIGH, ICON_THERMO_LOW } from "../icons";
import { getSubColBackground, getSubColShadow, DIAL_BACKGROUND } from "../theme";
import type { ForecastEntry } from "../types";

// ── Layout constants ───────────────────────────────────────────────
// Half-gap at dial edges so adjacent dials produce a full gap at the
// physical seam: g/2 + 0 + g/2 = g  ✓

const DIAL_W = 200;
const DIAL_H = 100;
const GAP = 6;
const EDGE_PAD = GAP / 2; // 3px at each dial edge
const CARD_W = Math.floor((DIAL_W - EDGE_PAD * 2 - GAP * (COLS_PER_DIAL - 1)) / COLS_PER_DIAL);
const CARD_H = DIAL_H - GAP; // top/bottom padding
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
// Big label watermark in background. Two rows: MAX and MIN with
// icon + label on left, value on right.

function DetailPanel({ entry, progress }: { entry: ForecastEntry; progress: number }) {
  const panelH = Math.round(DIAL_H * progress);
  const contentOpacity = Math.min(1, Math.max(0, (progress - 0.3) / 0.5));
  const bg = getSubColBackground(entry.isDay);

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        bottom: 0,
        width: DIAL_W,
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
            width: DIAL_W,
            height: DIAL_H,
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
              bottom: 8,
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

// ── Main component ─────────────────────────────────────────────────

function WeatherDial() {
  const dialColumn = useAction().coordinates?.column ?? 0;

  // Store state
  const forecast = useWeatherStore((s) => s.forecast);
  const scrollOffset = useWeatherStore((s) => s.scrollOffset);
  const cursor = useWeatherStore((s) => s.cursor);
  const expandedColumn = useWeatherStore((s) => s.expandedColumn);
  const isLoading = useWeatherStore((s) => s.isLoading && s.forecast.length === 0);

  const isExpanded = expandedColumn === dialColumn;
  const anotherIsExpanded = expandedColumn !== null && !isExpanded;

  // Get the 3 entries for this dial
  const entries = getDialEntries(forecast, scrollOffset, dialColumn);

  // ── Lifecycle: register/unregister this column ─────────────────

  useWillAppear(() => {
    useWeatherStore.getState().registerColumn(dialColumn);
  });

  useWillDisappear(() => {
    useWeatherStore.getState().unregisterColumn(dialColumn);
  });

  // ── Local animation state ──────────────────────────────────────

  const [progress, setProgress] = useState(0);
  const targetRef = useRef(0);
  targetRef.current = isExpanded ? 1 : 0;

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

  // ── Dial interactions ──────────────────────────────────────────

  useDialHint({
    rotate: "Navigate",
    press: "Expand details",
  });

  useDialRotate(({ ticks }) => {
    const store = useWeatherStore.getState();
    if (store.expandedColumn !== null) {
      store.closeExpanded();
      return;
    }
    store.moveCursor(ticks);
  });

  useDialDown(() => {
    const store = useWeatherStore.getState();

    // If any panel is expanded, close it
    if (store.expandedColumn !== null) {
      store.closeExpanded();
      return;
    }

    // Open the detail panel on the dial that has the cursor
    const cursorDialCol = Math.floor((store.cursor - store.scrollOffset) / COLS_PER_DIAL);
    store.toggleExpanded(cursorDialCol);
  });

  useDialUp(() => {
    // No-op: toggle on press, not release
  });

  useTouchTap(({ tapPos }) => {
    const store = useWeatherStore.getState();

    // If detail is open on this dial, close it
    if (store.expandedColumn === dialColumn) {
      store.closeExpanded();
      return;
    }

    // If detail is open on another dial, close it
    if (store.expandedColumn !== null) {
      store.closeExpanded();
      return;
    }

    // Determine which sub-column was tapped
    const x = tapPos[0];
    const subCol = Math.min(COLS_PER_DIAL - 1, Math.floor(x / (DIAL_W / COLS_PER_DIAL)));
    const forecastIdx = getForecastIndex(scrollOffset, dialColumn, subCol);

    if (forecastIdx < forecast.length) {
      if (store.cursor !== forecastIdx) {
        useWeatherStore.setState({ cursor: forecastIdx });
      }
      store.toggleExpanded(dialColumn);
    }
  });

  // ── Loading / empty states ─────────────────────────────────────

  if (isLoading) {
    return (
      <div
        className={tw("flex h-full w-full items-center justify-center")}
        style={{ backgroundColor: DIAL_BACKGROUND }}
      >
        <span className="text-[13px] text-white/50">Loading...</span>
      </div>
    );
  }

  if (forecast.length === 0) {
    return (
      <div
        className={tw("flex h-full w-full items-center justify-center")}
        style={{ backgroundColor: DIAL_BACKGROUND }}
      >
        <span className="text-[13px] text-white/30">No data</span>
      </div>
    );
  }

  // ── Detail entry for this dial ─────────────────────────────────

  const cursorSubCol = cursor - (scrollOffset + dialColumn * COLS_PER_DIAL);
  const cursorIsOnThisDial = cursorSubCol >= 0 && cursorSubCol < COLS_PER_DIAL;
  const detailEntry = cursorIsOnThisDial ? entries[cursorSubCol] : undefined;

  const showPanel = progress > 0.005 && detailEntry;

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div
      style={{
        width: "100%",
        height: DIAL_H,
        backgroundColor: DIAL_BACKGROUND,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Sub-columns row */}
      <div
        className={tw("flex items-center h-full w-full")}
        style={{
          paddingLeft: EDGE_PAD,
          paddingRight: EDGE_PAD,
          paddingTop: GAP / 2,
          paddingBottom: GAP / 2,
          gap: GAP + 0.5,
        }}
      >
        {entries.map((entry, i) => {
          const forecastIdx = getForecastIndex(scrollOffset, dialColumn, i);
          const isFocused = forecastIdx === cursor;

          if (!entry) {
            return <EmptyCard key={i} width={CARD_W} />;
          }

          return <MiniCard key={forecastIdx} entry={entry} isFocused={isFocused} width={CARD_W} />;
        })}
      </div>

      {/* Dark backdrop when another dial has the detail panel open */}
      {anotherIsExpanded && (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: DIAL_W,
            height: DIAL_H,
            backgroundColor: "rgba(0,0,0,0.5)",
            backdropFilter: "blur(3px)",
            zIndex: 5,
          }}
        />
      )}

      {/* Detail overlay (animated from bottom) */}
      {showPanel && <DetailPanel entry={detailEntry} progress={progress} />}
    </div>
  );
}

// ── Action definition ──────────────────────────────────────────────

export const weatherAction = defineAction({
  uuid: "com.example.react-weather.forecast",
  dial: WeatherDial,
});
