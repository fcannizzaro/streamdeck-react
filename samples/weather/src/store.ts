// ── Weather Store ──────────────────────────────────────────────────
// Zustand singleton for the weather touchbar.
// A single React root renders all 12 visible forecast cards on the
// full-width touch strip (800×100). A global cursor selects which
// entry is focused. Dial rotation moves it.

import { create } from "zustand";
import { fetchWeatherData, normalizeForecast } from "./api";
import type { ForecastEntry } from "./types";

// ── Constants ─────────────────────────────────────────────────────

const DEFAULT_LAT = 41.9028;
const DEFAULT_LON = 12.4964;
const POLL_INTERVAL = 15 * 60 * 1000; // 15 minutes

/** Number of sub-columns rendered per dial segment */
export const COLS_PER_SEGMENT = 3;

/** Number of dial segments on the touch strip */
export const NUM_SEGMENTS = 4;

/** Total visible entries across the touch strip */
const TOTAL_VISIBLE = NUM_SEGMENTS * COLS_PER_SEGMENT; // 12

// ── Store type ─────────────────────────────────────────────────────

interface WeatherStore {
  forecast: ForecastEntry[];
  isLoading: boolean;
  error: string | null;
  lastFetched: number | null;

  /** Global cursor index into forecast[]. Dial rotation moves this. */
  cursor: number;

  /** Scroll offset — first forecast index shown at the left edge. */
  scrollOffset: number;

  /**
   * Which segment (0-3) has the detail panel expanded.
   * null = no detail panel open.
   */
  expandedSegment: number | null;

  fetchForecast: (lat?: number, lon?: number) => Promise<void>;
  moveCursor: (ticks: number) => void;
  toggleExpanded: () => void;
  closeExpanded: () => void;
}

// ── Helpers ────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Ensure scrollOffset keeps cursor visible. */
function adjustScroll(cursor: number, scrollOffset: number, maxIdx: number): number {
  const maxScroll = Math.max(0, maxIdx - TOTAL_VISIBLE + 1);
  let offset = scrollOffset;
  if (cursor < offset) offset = cursor;
  if (cursor >= offset + TOTAL_VISIBLE) offset = cursor - TOTAL_VISIBLE + 1;
  return clamp(offset, 0, maxScroll);
}

// ── Store ──────────────────────────────────────────────────────────

export const useWeatherStore = create<WeatherStore>((set, get) => ({
  forecast: [],
  isLoading: false,
  error: null,
  lastFetched: null,
  cursor: 0,
  scrollOffset: 0,
  expandedSegment: null,

  fetchForecast: async (lat = DEFAULT_LAT, lon = DEFAULT_LON) => {
    if (get().isLoading) return;

    set({ isLoading: true, error: null });
    try {
      const data = await fetchWeatherData(lat, lon);
      const forecast = normalizeForecast(data);
      const maxIdx = Math.max(0, forecast.length - 1);
      const cursor = clamp(get().cursor, 0, maxIdx);
      set({
        forecast,
        isLoading: false,
        lastFetched: Date.now(),
        cursor,
        scrollOffset: adjustScroll(cursor, get().scrollOffset, maxIdx),
      });
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  },

  moveCursor: (ticks: number) => {
    const { forecast, cursor, scrollOffset } = get();
    if (forecast.length === 0) return;

    const maxIdx = forecast.length - 1;
    const next = clamp(cursor + ticks, 0, maxIdx);
    if (next === cursor) return;

    set({
      cursor: next,
      scrollOffset: adjustScroll(next, scrollOffset, maxIdx),
    });
  },

  toggleExpanded: () => {
    const { expandedSegment, cursor, scrollOffset } = get();
    const cursorSegment = Math.floor((cursor - scrollOffset) / COLS_PER_SEGMENT);
    set({
      expandedSegment: expandedSegment === cursorSegment ? null : cursorSegment,
    });
  },

  closeExpanded: () => {
    set({ expandedSegment: null });
  },
}));

// ── Derived helpers (pure functions) ───────────────────────────────

/** Get the 3 forecast entries visible on a given segment. */
export function getSegmentEntries(
  forecast: ForecastEntry[],
  scrollOffset: number,
  segment: number,
): (ForecastEntry | undefined)[] {
  const start = scrollOffset + segment * COLS_PER_SEGMENT;
  return [forecast[start], forecast[start + 1], forecast[start + 2]];
}

/** Get the forecast index for a sub-column within a segment. */
export function getForecastIndex(scrollOffset: number, segment: number, subCol: number): number {
  return scrollOffset + segment * COLS_PER_SEGMENT + subCol;
}

// ── Auto-polling ───────────────────────────────────────────────────

function startPolling() {
  useWeatherStore.getState().fetchForecast();
  setInterval(() => {
    useWeatherStore.getState().fetchForecast();
  }, POLL_INTERVAL);
}

startPolling();
