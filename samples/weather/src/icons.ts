// ── Weather Icons ───────────────────────────────────────────────────
// Multi-color SVG icon system for weather conditions.
// Icons are composed of colored layers rendered by WeatherIcon.
// Style inspired by Elgato's Stream Deck adaptive design icons:
// rounded white clouds, gold sun with pill-shaped rays, colored rain.

import { createElement } from "react";

// ── Types ──────────────────────────────────────────────────────────

export interface IconLayer {
  d: string;
  fill: string;
  opacity?: number;
  transform?: string;
}

export type WeatherIconData = IconLayer[];

// ── WeatherIcon Component ──────────────────────────────────────────

export function WeatherIcon({ icon, size = 24 }: { icon: WeatherIconData; size?: number }) {
  return createElement(
    "svg",
    { width: size, height: size, viewBox: "0 0 24 24" },
    ...icon.map((layer, i) =>
      createElement("path", {
        key: i,
        d: layer.d,
        fill: layer.fill,
        opacity: layer.opacity,
        transform: layer.transform,
      }),
    ),
  );
}

// ── Colors ─────────────────────────────────────────────────────────

const SUN = "#FFD93D";
const MOON = "#C4C9D4";
const CLOUD = "white";
const RAIN = "#7CB4D9";
const LIGHTNING = "#FFD93D";
const FOG_COLOR = "rgba(255,255,255,0.6)";

// ── SVG Paths ──────────────────────────────────────────────────────

// Full sun — circle r=4.2 at (12, 12) + 12 pill-shaped rays
const SUN_CIRCLE = "M12 7.8a4.2 4.2 0 100 8.4 4.2 4.2 0 000-8.4z";
// Single ray capsule (vertical, at top) — rotated 12× at 30° intervals around (12, 12)
// Capsule: hw=0.85, body y=3→6, caps extend to y=2.15/6.85. Gap from circle = 0.95
const SUN_RAY = "M11.15 3a0.85 0.85 0 011.7 0v3a0.85 0.85 0 01-1.7 0z";

function sunRays(cx: number, cy: number, ray: string): IconLayer[] {
  return Array.from({ length: 12 }, (_, i) => ({
    d: ray,
    fill: SUN,
    transform: `rotate(${i * 30}, ${cx}, ${cy})`,
  }));
}

// Small sun — circle r=2.2 at (18, 5), peeks behind cloud upper-right
const SUN_SMALL_CIRCLE = "M18 2.8a2.2 2.2 0 100 4.4 2.2 2.2 0 000-4.4z";
// Capsule: hw=0.45, body y=0→2, caps extend to y=-0.45/2.45. Gap from circle = 0.35
const SUN_SMALL_RAY = "M17.55 0a0.45 0.45 0 01.9 0v2a0.45 0.45 0 01-.9 0z";

// Crescent moon
const MOON_PATH =
  "M12 3a9 9 0 109 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 01-4.4 2.26 5.403 5.403 0 01-3.14-9.8c-.44-.06-.9-.1-1.36-.1z";

// Solid filled cloud (Material Design)
const CLOUD_PATH =
  "M19.35 10.04A7.49 7.49 0 0012 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 000 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z";

// Fog horizontal bars
const FOG_PATH = "M3 15h18v-2H3v2zm0 4h18v-2H3v2zm0-8h18V9H3v2zm0-6v2h18V5H3z";

// Rain streaks — 3 angled parallelograms below the cloud
const RAIN_PATH =
  "M7.8 19L6.5 23.5h1L8.8 19zM12.3 19.5L11 23.5h1L13.3 19.5zM16.8 19L15.5 23.5h1L17.8 19z";

// Snow dots — 3 circles below the cloud
const SNOW_PATH =
  "M7.5 20.5a1 1 0 100 2 1 1 0 000-2zM12 21a1 1 0 100 2 1 1 0 000-2zM16.5 20.5a1 1 0 100 2 1 1 0 000-2z";

// Lightning bolt — extends from inside the cloud downward
const LIGHTNING_PATH = "M13 15L11.5 18H13.5L12 21 16 17H14L16 15Z";

// ── Icon Compositions ──────────────────────────────────────────────

const ICON_SUN: WeatherIconData = [{ d: SUN_CIRCLE, fill: SUN }, ...sunRays(12, 12, SUN_RAY)];

const ICON_MOON: WeatherIconData = [{ d: MOON_PATH, fill: MOON }];

const ICON_CLOUD_SUN: WeatherIconData = [
  { d: SUN_SMALL_CIRCLE, fill: SUN },
  ...sunRays(18, 5, SUN_SMALL_RAY),
  { d: CLOUD_PATH, fill: CLOUD },
];

const ICON_CLOUD_MOON: WeatherIconData = [
  { d: MOON_PATH, fill: MOON },
  { d: CLOUD_PATH, fill: CLOUD },
];

const ICON_CLOUD: WeatherIconData = [{ d: CLOUD_PATH, fill: CLOUD }];

const ICON_FOG: WeatherIconData = [{ d: FOG_PATH, fill: FOG_COLOR }];

// Rain: drops behind, cloud on top — creates "rain from cloud" effect
const ICON_RAIN: WeatherIconData = [
  { d: RAIN_PATH, fill: RAIN },
  { d: CLOUD_PATH, fill: CLOUD },
];

// Snow: dots behind, cloud on top
const ICON_SNOW: WeatherIconData = [
  { d: SNOW_PATH, fill: CLOUD, opacity: 0.85 },
  { d: CLOUD_PATH, fill: CLOUD },
];

// Thunder: cloud first, bolt on top (visible over + below cloud)
const ICON_THUNDER: WeatherIconData = [
  { d: CLOUD_PATH, fill: CLOUD },
  { d: LIGHTNING_PATH, fill: LIGHTNING },
];

// ── Detail panel metric icons (single-path, used with <Icon>) ─────

/** Thermometer high (MAX) */
export const ICON_THERMO_HIGH =
  "M15 13V5c0-1.66-1.34-3-3-3S9 3.34 9 5v8c-1.21.91-2 2.37-2 4 0 2.76 2.24 5 5 5s5-2.24 5-5c0-1.63-.79-3.09-2-4zm-4-8c0-.55.45-1 1-1s1 .45 1 1v4h-2V5z";

/** Thermometer low (MIN) */
export const ICON_THERMO_LOW =
  "M15 13V5c0-1.66-1.34-3-3-3S9 3.34 9 5v8c-1.21.91-2 2.37-2 4 0 2.76 2.24 5 5 5s5-2.24 5-5c0-1.63-.79-3.09-2-4z";

// ── Icon Resolver ──────────────────────────────────────────────────
// Maps WMO weather codes to multi-color icon compositions.
// See: https://open-meteo.com/en/docs — WMO Weather interpretation codes (WW)

export function getWeatherIcon(weatherCode: number, isDay: boolean): WeatherIconData {
  // Clear sky
  if (weatherCode === 0) return isDay ? ICON_SUN : ICON_MOON;

  // Mainly clear, partly cloudy
  if (weatherCode <= 2) return isDay ? ICON_CLOUD_SUN : ICON_CLOUD_MOON;

  // Overcast
  if (weatherCode === 3) return ICON_CLOUD;

  // Fog
  if (weatherCode === 45 || weatherCode === 48) return ICON_FOG;

  // Drizzle (51, 53, 55, 56, 57)
  if (weatherCode >= 51 && weatherCode <= 57) return ICON_RAIN;

  // Rain (61, 63, 65, 66, 67)
  if (weatherCode >= 61 && weatherCode <= 67) return ICON_RAIN;

  // Snow (71, 73, 75, 77)
  if (weatherCode >= 71 && weatherCode <= 77) return ICON_SNOW;

  // Rain showers (80, 81, 82)
  if (weatherCode >= 80 && weatherCode <= 82) return ICON_RAIN;

  // Snow showers (85, 86)
  if (weatherCode >= 85 && weatherCode <= 86) return ICON_SNOW;

  // Thunderstorm (95, 96, 99)
  if (weatherCode >= 95) return ICON_THUNDER;

  // Fallback
  return ICON_CLOUD;
}
