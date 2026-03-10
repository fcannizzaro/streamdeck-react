// ── Forecast Entry ──────────────────────────────────────────────────
// A single forecast data point displayed on one dial card.

export interface ForecastEntry {
  /** Unix timestamp (seconds) */
  dt: number;
  /** Temperature value (in the configured unit) */
  temp: number;
  /** WMO weather interpretation code (0-99) */
  weatherCode: number;
  /** Whether this timestamp falls during daylight hours */
  isDay: boolean;
  /** Display label — day name ("THU", "SAT") or time ("15:00", "21:00") */
  label: string;

  // ── Detail metrics ─────────────────────────────────────────────
  /** Maximum temperature for the day */
  tempMax: number;
  /** Minimum temperature for the day */
  tempMin: number;
  /** Relative humidity percentage (0-100) */
  humidity: number;
  /** Wind speed in km/h */
  windSpeed: number;
}

// ── Global Settings ────────────────────────────────────────────────
// Persisted via Stream Deck's useGlobalSettings mechanism.

export interface WeatherGlobalSettings {
  lat?: number;
  lon?: number;
  units?: "celsius" | "fahrenheit";
  locationName?: string;
}

// ── Open-Meteo API Response ────────────────────────────────────────

export interface OpenMeteoHourly {
  time: string[];
  temperature_2m: number[];
  weather_code: number[];
  is_day: number[];
  relative_humidity_2m: number[];
  wind_speed_10m: number[];
}

export interface OpenMeteoDaily {
  time: string[];
  weather_code: number[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
  precipitation_probability_max: number[];
}

export interface OpenMeteoResponse {
  latitude: number;
  longitude: number;
  timezone: string;
  hourly: OpenMeteoHourly;
  daily: OpenMeteoDaily;
}
