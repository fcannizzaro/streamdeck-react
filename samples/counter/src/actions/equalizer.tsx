import { useState, useRef } from "react";
import {
  defineAction,
  useTouchStrip,
  useTouchStripDialRotate,
  useTouchStripDialDown,
  useTouchStripTap,
  useTick,
} from "@fcannizzaro/streamdeck-react";

// ── Equalizer TouchStrip ────────────────────────────────────────────
// An animated equalizer spanning the full Stream Deck+ touch strip.
//
// Dial 0: Speed — CW = faster, CCW = slower
// Dial 1: Amplitude — CW = taller bars, CCW = shorter
// Dial 2: Pause / Resume (press)
// Dial 3: Reset to defaults (press)
// Touch tap: Cycle color theme

const BAR_COUNT = 32;
const BAR_GAP = 3;
const MIN_SPEED = 0.2;
const MAX_SPEED = 5;
const DEFAULT_SPEED = 1;
const DEFAULT_AMPLITUDE = 0.8;

const THEMES = [
  { from: "#667eea", to: "#764ba2" }, // Purple gradient
  { from: "#00ff88", to: "#00aa55" }, // Green
  { from: "#ff3366", to: "#ff9966" }, // Red-orange
  { from: "#00bcd4", to: "#2196f3" }, // Cyan-blue
  { from: "#ffd700", to: "#ff8c00" }, // Gold
] as const;

function lerpColor(a: string, b: string, t: number): string {
  const parseHex = (hex: string) => {
    const h = hex.replace("#", "");
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  };
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  const r = Math.round(ar! + (br! - ar!) * t);
  const g = Math.round(ag! + (bg! - ag!) * t);
  const blue = Math.round(ab! + (bb! - ab!) * t);
  return `rgb(${r},${g},${blue})`;
}

function EqualizerTouchStrip() {
  const { width, height, fps, segmentWidth } = useTouchStrip();

  const [speed, setSpeed] = useState(DEFAULT_SPEED);
  const [amplitude, setAmplitude] = useState(DEFAULT_AMPLITUDE);
  const [paused, setPaused] = useState(false);
  const [themeIndex, setThemeIndex] = useState(0);
  const timeRef = useRef(0);
  const [time, setTime] = useState(0);

  const theme = THEMES[themeIndex % THEMES.length]!;
  const barWidth = (width - BAR_GAP * (BAR_COUNT + 1)) / BAR_COUNT;

  // ── Animation Loop ──────────────────────────────────────────────
  useTick((delta) => {
    if (paused) return;
    timeRef.current += delta * 0.001 * speed;
    setTime(timeRef.current);
  }, fps);

  // ── Dial 0: Speed, Dial 1: Amplitude ───────────────────────────
  useTouchStripDialRotate(({ column, ticks }) => {
    if (column === 0) {
      setSpeed((s) => Math.max(MIN_SPEED, Math.min(MAX_SPEED, s + ticks * 0.2)));
    } else if (column === 1) {
      setAmplitude((a) => Math.max(0.1, Math.min(1, a + ticks * 0.05)));
    }
  });

  // ── Dial 2: Pause, Dial 3: Reset ──────────────────────────────
  useTouchStripDialDown(({ column }) => {
    if (column === 2) {
      setPaused((p) => !p);
    } else if (column === 3) {
      setSpeed(DEFAULT_SPEED);
      setAmplitude(DEFAULT_AMPLITUDE);
      setPaused(false);
      timeRef.current = 0;
      setTime(0);
    }
  });

  // ── Touch Tap: Cycle theme ─────────────────────────────────────
  useTouchStripTap(() => {
    setThemeIndex((i) => (i + 1) % THEMES.length);
  });

  const labels = [
    `SPD ${speed.toFixed(1)}x`,
    `AMP ${Math.round(amplitude * 100)}%`,
    paused ? "RESUME" : "PAUSE",
    "RESET",
  ];

  // ── Render ─────────────────────────────────────────────────────
  return (
    <div
      style={{
        width,
        height,
        position: "relative",
        overflow: "hidden",
        background: "#0d1117",
      }}
    >
      {/* Bars */}
      {Array.from({ length: BAR_COUNT }, (_, i) => {
        const phase = (i / BAR_COUNT) * Math.PI * 4;
        const wave1 = Math.sin(time * 2 + phase) * 0.5 + 0.5;
        const wave2 = Math.sin(time * 3.7 + phase * 0.6) * 0.3 + 0.3;
        const value = Math.min(1, (wave1 + wave2) * amplitude);
        const barHeight = Math.max(2, value * (height - 10));
        const x = BAR_GAP + i * (barWidth + BAR_GAP);
        const color = lerpColor(theme.from, theme.to, i / BAR_COUNT);

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              bottom: 5,
              width: barWidth,
              height: barHeight,
              background: color,
              borderRadius: 2,
            }}
          />
        );
      })}

      {/* Segment labels */}
      {[0, 1, 2, 3].map((col) => (
        <div
          key={`label-${col}`}
          style={{
            position: "absolute",
            left: col * segmentWidth,
            top: 4,
            width: segmentWidth,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span
            style={{
              color: "white",
              fontSize: 10,
              fontFamily: "Inter",
              opacity: 0.4,
            }}
          >
            {labels[col]}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Action Definition ───────────────────────────────────────────────
// Place on all encoder slots — they share a single touchstrip render.

export const equalizerAction = defineAction({
  uuid: "com.example.react-counter.equalizer",
  touchStrip: EqualizerTouchStrip,
  touchStripFPS: 60,
});
