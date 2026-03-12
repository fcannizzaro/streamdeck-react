import { useState } from "react";
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
const MIN_SPEED = 0;
const MAX_SPEED = 5;
const DEFAULT_SPEED = 0.4;
const DEFAULT_AMPLITUDE = 0.8;

// ── Traveling wave constants ─────────────────────────────────────────
//
// The animation uses a wrapping frame counter to enable the framework's
// tree-hash → segment-URI LRU cache to skip rendering on subsequent
// loop iterations.
//
// The wave is a traveling sine: sin(spatialPhase - scrollPhase).
// It scrolls rightward across the strip, tiling seamlessly — the
// pattern at the right edge connects perfectly to the left edge,
// creating the illusion of an infinite, symmetric scroll.
//
// SPATIAL_WAVES controls how many wave peaks are visible across the
// strip at any moment.  SCROLL_K controls the temporal speed.
// For seamless looping, SCROLL_K * speed must be an integer.
// With speed step 0.1 (= 1/10), SCROLL_K must be a multiple of 10.

const CYCLE_FRAMES = 60; // 2 seconds at 30fps
const SCROLL_K = 10; // temporal frequency — 10 * 0.1 = 1 (integer) ✓
const SPATIAL_WAVES = 2; // two full sine cycles across the strip
const BASE_FREQ = (2 * Math.PI) / CYCLE_FRAMES;

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
  const { width, height, segmentWidth } = useTouchStrip();

  const [speed, setSpeed] = useState(DEFAULT_SPEED);
  const [amplitude, setAmplitude] = useState(DEFAULT_AMPLITUDE);
  const [paused, setPaused] = useState(false);
  const [themeIndex, setThemeIndex] = useState(0);
  const [frame, setFrame] = useState(0);

  const theme = THEMES[themeIndex % THEMES.length]!;
  const barWidth = (width - BAR_GAP * (BAR_COUNT + 1)) / BAR_COUNT;

  // ── Animation Loop ──────────────────────────────────────────────
  // Wrapping frame counter: after CYCLE_FRAMES frames, the counter
  // resets to 0.  With stable speed/amplitude, the VNode tree at
  // frame N in cycle 2 is identical to frame N in cycle 1, so the
  // framework's segment URI cache hits on every subsequent cycle.
  useTick(() => {
    if (paused) return;
    setFrame((f) => (f + 1) % CYCLE_FRAMES);
  });

  // ── Dial 0: Speed, Dial 1: Amplitude ───────────────────────────
  // Rounding prevents floating-point drift (e.g. 1.0 + 0.2 + 0.2 =
  // 1.4000000000000001) which would break tree hash matching between
  // loop iterations.
  useTouchStripDialRotate(({ column, ticks }) => {
    if (column === 0) {
      setSpeed((s) => {
        const next = s + ticks * 0.1;
        return Math.max(MIN_SPEED, Math.min(MAX_SPEED, Math.round(next * 10) / 10));
      });
    } else if (column === 1) {
      setAmplitude((a) => {
        const next = a + ticks * 0.05;
        return Math.max(0.1, Math.min(1, Math.round(next * 100) / 100));
      });
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
      setFrame(0);
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
        // Spatial phase: wraps exactly over BAR_COUNT, tiling seamlessly
        const spatial = (i / BAR_COUNT) * Math.PI * 2 * SPATIAL_WAVES;
        // Temporal phase: advances each frame, scrolling the wave
        const scroll = frame * BASE_FREQ * SCROLL_K * speed;

        // Sea wave: superposition of harmonics with wave dispersion.
        // Each harmonic has a different phase velocity (temporal/spatial freq),
        // so the composite shape morphs over time like real ocean waves.
        // All frequencies are integers → seamless edge tiling + temporal looping.
        const wave1 = Math.sin(spatial - scroll);
        const wave2 = Math.sin(spatial * 2 - scroll * 3) * 0.35;
        const wave3 = Math.sin(spatial * 3 - scroll * 2) * 0.15;
        const raw = (wave1 + wave2 + wave3) / 1.5; // normalize to ~[-1, 1]
        const value = Math.max(0, Math.min(1, raw * 0.5 + 0.5)) * amplitude;
        const barHeight = Math.max(2, value * (height - 10));
        const x = BAR_GAP + i * (barWidth + BAR_GAP);
        const color = lerpColor(theme.from, theme.to, i / BAR_COUNT);

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: height - 5 - barHeight,
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
});
