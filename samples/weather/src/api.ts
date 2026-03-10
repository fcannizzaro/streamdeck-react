// ── Open-Meteo API ─────────────────────────────────────────────────
// Fetches weather forecast and normalizes into ForecastEntry[].

import type { ForecastEntry, OpenMeteoResponse } from "./types";

const BASE_URL = "https://api.open-meteo.com/v1/forecast";

const DAY_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;

/**
 * Fetch weather data from Open-Meteo.
 */
export async function fetchWeatherData(
  lat: number,
  lon: number,
  units: "celsius" | "fahrenheit" = "celsius",
): Promise<OpenMeteoResponse> {
  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lon.toString(),
    hourly: "temperature_2m,weather_code,is_day,relative_humidity_2m,wind_speed_10m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    timezone: "auto",
    forecast_days: "7",
    temperature_unit: units,
  });

  const res = await fetch(`${BASE_URL}?${params}`);
  if (!res.ok) throw new Error(`Open-Meteo API error: ${res.status}`);
  return res.json() as Promise<OpenMeteoResponse>;
}

// ── Helpers ────────────────────────────────────────────────────────

/** Find the daily index for a given date string (YYYY-MM-DD prefix). */
function findDailyIndex(dailyTimes: string[], hourlyTimeStr: string): number {
  const datePrefix = hourlyTimeStr.slice(0, 10); // "2026-03-10"
  return dailyTimes.findIndex((d) => d.startsWith(datePrefix));
}

/**
 * Normalize API response into a mixed-granularity ForecastEntry[].
 * - Next 24h: one entry every 3 hours, labeled with time ("15:00")
 * - Beyond 24h: one entry per day, labeled with day name ("SAT")
 */
export function normalizeForecast(data: OpenMeteoResponse): ForecastEntry[] {
  const entries: ForecastEntry[] = [];
  const now = Date.now();

  const {
    time: hTime,
    temperature_2m,
    weather_code: hCode,
    is_day,
    relative_humidity_2m,
    wind_speed_10m,
  } = data.hourly;

  const { time: dTime, weather_code: dCode, temperature_2m_max, temperature_2m_min } = data.daily;

  // ── Hourly entries (next ~24h, every 3 hours) ────────────────────

  for (let i = 0; i < hTime.length; i++) {
    const timeStr = hTime[i]!;
    const dt = new Date(timeStr).getTime();

    if (dt < now) continue;
    if (dt - now > 24 * 60 * 60 * 1000) break;

    const hour = new Date(timeStr).getHours();
    if (hour % 3 !== 0) continue;

    // Cross-reference the daily data for this hour's date
    const dayIdx = findDailyIndex(dTime, timeStr);
    const dayMax = dayIdx >= 0 ? temperature_2m_max[dayIdx]! : temperature_2m[i]!;
    const dayMin = dayIdx >= 0 ? temperature_2m_min[dayIdx]! : temperature_2m[i]!;

    entries.push({
      dt: Math.floor(dt / 1000),
      temp: Math.round(temperature_2m[i]!),
      weatherCode: hCode[i]!,
      isDay: is_day[i] === 1,
      label: `${String(hour).padStart(2, "0")}:00`,
      tempMax: Math.round(dayMax),
      tempMin: Math.round(dayMin),
      humidity: Math.round(relative_humidity_2m[i]!),
      windSpeed: Math.round(wind_speed_10m[i]!),
    });
  }

  // ── Daily entries (beyond 24h) ───────────────────────────────────

  const oneDayFromNow = now + 24 * 60 * 60 * 1000;

  for (let i = 0; i < dTime.length; i++) {
    const timeStr = dTime[i]!;
    const dt = new Date(timeStr).getTime();
    if (dt < oneDayFromNow) continue;

    const date = new Date(timeStr);
    const maxTemp = temperature_2m_max[i]!;
    const minTemp = temperature_2m_min[i]!;
    const avgTemp = Math.round((maxTemp + minTemp) / 2);

    // For daily entries, estimate humidity/wind from the noon hour
    const noonStr = `${timeStr}T12:00`;
    const noonIdx = hTime.indexOf(noonStr);
    const humidity = noonIdx >= 0 ? Math.round(relative_humidity_2m[noonIdx]!) : 0;
    const windSpeed = noonIdx >= 0 ? Math.round(wind_speed_10m[noonIdx]!) : 0;

    entries.push({
      dt: Math.floor(dt / 1000),
      temp: avgTemp,
      weatherCode: dCode[i]!,
      isDay: true,
      label: DAY_NAMES[date.getDay()]!,
      tempMax: Math.round(maxTemp),
      tempMin: Math.round(minTemp),
      humidity,
      windSpeed,
    });
  }

  return entries;
}
