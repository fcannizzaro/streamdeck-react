// ── Weather Store ──────────────────────────────────────────────────
// Zustand singleton for the weather touchstrip.
// A single React root renders visible forecast cards on the
// full-width touch strip (800×100). A global cursor selects which
// entry is focused. Dial rotation scrolls through the forecast.

import { create } from "zustand";
import { fetchGeoIp, fetchWeatherData, normalizeForecast } from "./api";
import type { ForecastEntry } from "./types";

// ── Constants ─────────────────────────────────────────────────────

const DEFAULT_LAT = 41.9028;
const DEFAULT_LON = 12.4964;
const POLL_INTERVAL = 15 * 60 * 1000; // 15 minutes

/** Number of forecast cards shown per dial segment. */
export const CARDS_PER_SEGMENT = 3;

/** Default segment count (Stream Deck+ has 4 dials). */
const DEFAULT_SEGMENTS = 4;

// ── Store type ─────────────────────────────────────────────────────

interface WeatherStore {
  forecast: ForecastEntry[];
  isLoading: boolean;
  error: string | null;
  lastFetched: number | null;

  /** User-configured latitude. Falls back to DEFAULT_LAT when unset. */
  lat: number | null;
  /** User-configured longitude. Falls back to DEFAULT_LON when unset. */
  lon: number | null;

  /** Number of active dial segments on the touch strip. */
  segmentCount: number;

  /** Total visible cards (segmentCount × CARDS_PER_SEGMENT). */
  totalVisible: number;

  /** Global cursor index into forecast[]. Dial rotation moves this. */
  cursor: number;

  /** Scroll offset — first forecast index shown at the left edge. */
  scrollOffset: number;

  /** Whether the detail panel is expanded for the focused card. */
  expanded: boolean;

  setCoordinates: (lat: number | null, lon: number | null) => void;
  setSegmentCount: (count: number) => void;
  fetchForecast: () => Promise<void>;
  moveCursor: (ticks: number) => void;
  toggleExpanded: () => void;
  closeExpanded: () => void;
}

// ── Helpers ────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Ensure scrollOffset keeps cursor visible. */
function adjustScroll(
  cursor: number,
  scrollOffset: number,
  maxIdx: number,
  totalVisible: number,
): number {
  const maxScroll = Math.max(0, maxIdx - totalVisible + 1);
  let offset = scrollOffset;
  if (cursor < offset) offset = cursor;
  if (cursor >= offset + totalVisible) offset = cursor - totalVisible + 1;
  return clamp(offset, 0, maxScroll);
}

// ── Store ──────────────────────────────────────────────────────────

export const useWeatherStore = create<WeatherStore>((set, get) => ({
  forecast: [],
  isLoading: false,
  error: null,
  lastFetched: null,
  lat: null,
  lon: null,
  segmentCount: DEFAULT_SEGMENTS,
  totalVisible: DEFAULT_SEGMENTS * CARDS_PER_SEGMENT,
  cursor: 0,
  scrollOffset: 0,
  expanded: false,

  setCoordinates: (lat, lon) => {
    const state = get();
    if (state.lat === lat && state.lon === lon) return;
    set({ lat, lon });
    // Re-fetch immediately with the new coordinates
    state.fetchForecast();
  },

  setSegmentCount: (count: number) => {
    const state = get();
    if (state.segmentCount === count) return;
    const totalVisible = count * CARDS_PER_SEGMENT;
    const maxIdx = Math.max(0, state.forecast.length - 1);
    const cursor = clamp(state.cursor, 0, maxIdx);
    set({
      segmentCount: count,
      totalVisible,
      cursor,
      scrollOffset: adjustScroll(cursor, state.scrollOffset, maxIdx, totalVisible),
    });
  },

  fetchForecast: async () => {
    if (get().isLoading) return;

    const { lat, lon, totalVisible } = get();

    set({ isLoading: true, error: null });
    try {
      const data = await fetchWeatherData(lat ?? DEFAULT_LAT, lon ?? DEFAULT_LON);
      const forecast = normalizeForecast(data);
      const maxIdx = Math.max(0, forecast.length - 1);
      const cursor = clamp(get().cursor, 0, maxIdx);
      set({
        forecast,
        isLoading: false,
        lastFetched: Date.now(),
        cursor,
        scrollOffset: adjustScroll(cursor, get().scrollOffset, maxIdx, totalVisible),
      });
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  },

  moveCursor: (ticks: number) => {
    const { forecast, cursor, scrollOffset, totalVisible } = get();
    if (forecast.length === 0) return;

    const maxIdx = forecast.length - 1;
    const next = clamp(cursor + ticks, 0, maxIdx);
    if (next === cursor) return;

    set({
      cursor: next,
      scrollOffset: adjustScroll(next, scrollOffset, maxIdx, totalVisible),
    });
  },

  toggleExpanded: () => {
    set({ expanded: !get().expanded });
  },

  closeExpanded: () => {
    set({ expanded: false });
  },
}));

// ── Auto-polling ───────────────────────────────────────────────────

async function startPolling() {
  // Detect location from IP, then fetch immediately
  const geo = await fetchGeoIp();
  if (geo) {
    useWeatherStore.getState().setCoordinates(geo.lat, geo.lon);
  } else {
    // Fall back to defaults (Rome)
    useWeatherStore.getState().fetchForecast();
  }

  setInterval(() => {
    useWeatherStore.getState().fetchForecast();
  }, POLL_INTERVAL);
}

startPolling();
