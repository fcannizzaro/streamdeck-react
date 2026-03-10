// ── Weather Store ──────────────────────────────────────────────────
// Zustand singleton shared across all 4 independent dial React roots.
// Each dial shows 3 sub-columns. 4 dials × 3 = 12 visible entries.
// A global cursor selects which entry is focused. Dial rotation moves it.

import { create } from "zustand";
import { fetchWeatherData, normalizeForecast } from "./api";
import type { ForecastEntry } from "./types";

// ── Constants ─────────────────────────────────────────────────────

const DEFAULT_LAT = 41.9028;
const DEFAULT_LON = 12.4964;
const POLL_INTERVAL = 15 * 60 * 1000; // 15 minutes

/** Number of sub-columns rendered per dial */
export const COLS_PER_DIAL = 3;

/** Total visible entries across all 4 dials */
const TOTAL_VISIBLE = 4 * COLS_PER_DIAL; // 12

// ── Store type ─────────────────────────────────────────────────────

interface WeatherStore {
  forecast: ForecastEntry[];
  isLoading: boolean;
  error: string | null;
  lastFetched: number | null;

  /** Global cursor index into forecast[]. Dial rotation moves this. */
  cursor: number;

  /** Scroll offset — first forecast index shown on dial 0, sub-col 0. */
  scrollOffset: number;

  /**
   * Which encoder column (0-3) has the detail panel expanded.
   * null = no detail panel open.
   */
  expandedColumn: number | null;

  /** Set of encoder columns that have an active weather dial. */
  activeColumns: number[];

  fetchForecast: (lat?: number, lon?: number) => Promise<void>;
  moveCursor: (ticks: number) => void;
  toggleExpanded: (column: number) => void;
  closeExpanded: () => void;
  registerColumn: (column: number) => void;
  unregisterColumn: (column: number) => void;
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
  expandedColumn: null,
  activeColumns: [],

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

  toggleExpanded: (column: number) => {
    const { expandedColumn } = get();
    // Toggle: if same column → close, otherwise open new one
    set({ expandedColumn: expandedColumn === column ? null : column });
  },

  closeExpanded: () => {
    set({ expandedColumn: null });
  },

  registerColumn: (column: number) => {
    const { activeColumns } = get();
    if (!activeColumns.includes(column)) {
      set({ activeColumns: [...activeColumns, column].sort() });
    }
  },

  unregisterColumn: (column: number) => {
    const { activeColumns } = get();
    set({ activeColumns: activeColumns.filter((c) => c !== column) });
  },
}));

// ── Derived helpers (pure functions) ───────────────────────────────

/** Get the 3 forecast entries visible on a given dial column. */
export function getDialEntries(
  forecast: ForecastEntry[],
  scrollOffset: number,
  dialColumn: number,
): (ForecastEntry | undefined)[] {
  const start = scrollOffset + dialColumn * COLS_PER_DIAL;
  return [forecast[start], forecast[start + 1], forecast[start + 2]];
}

/** Get the forecast index for a sub-column within a dial. */
export function getForecastIndex(scrollOffset: number, dialColumn: number, subCol: number): number {
  return scrollOffset + dialColumn * COLS_PER_DIAL + subCol;
}

// ── Auto-polling ───────────────────────────────────────────────────

function startPolling() {
  useWeatherStore.getState().fetchForecast();
  setInterval(() => {
    useWeatherStore.getState().fetchForecast();
  }, POLL_INTERVAL);
}

startPolling();
