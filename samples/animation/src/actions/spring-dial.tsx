import { useState } from "react";
import {
  defineAction,
  useTouchStrip,
  useTouchStripDialRotate,
  useTouchStripDialDown,
  useTouchStripTap,
  useSpring,
  useTween,
  SpringPresets,
  tw,
} from "@fcannizzaro/streamdeck-react";

// ── Spring Dial TouchStrip ──────────────────────────────────────────
// Demonstrates spring and tween animation on the touchstrip: a ball follows
// dial rotation. Tap the top-left label to switch between spring and tween
// animation modes. Press dial to toggle ball size.

// Approximate hit area for the top-left animation type label
const LABEL_TAP_WIDTH = 100;
const LABEL_TAP_HEIGHT = 24;

function SpringDial() {
  const { width, height } = useTouchStrip();
  const [target, setTarget] = useState(width / 2);
  const [big, setBig] = useState(false);
  const [mode, setMode] = useState<"spring" | "tween">("spring");

  // Both hooks are always called (rules of hooks); we pick the active value below.
  const spring = useSpring(target, SpringPresets.wobbly);
  const tween = useTween(target, { duration: 400, easing: "easeOutCubic" });

  const { value: x, isAnimating } = mode === "spring" ? spring : tween;

  // Spring-animated radius on press (always spring — feels better for size toggle)
  const { value: r } = useSpring(big ? 35 : 18, SpringPresets.stiff);

  useTouchStripDialRotate(({ ticks }) => {
    setTarget((t) => Math.max(20, Math.min(width - 20, t + ticks * 15)));
  });

  useTouchStripDialDown(() => {
    setBig((b) => !b);
  });

  useTouchStripTap(({ tapPos, hold }) => {
    // Tap on the top-left label toggles animation mode
    if (tapPos[0] < LABEL_TAP_WIDTH && tapPos[1] < LABEL_TAP_HEIGHT) {
      setMode((m) => (m === "spring" ? "tween" : "spring"));
      return;
    }

    setTarget(Math.max(20, Math.min(width - 20, tapPos[0])));
    if (hold) {
      setBig((b) => !b);
    }
  });

  const ballColor = isAnimating ? "#ff6b6b" : "#4ecdc4";
  const cx = Math.round(x);
  const cr = Math.round(r);
  const cy = Math.round(height / 2);
  const label = mode === "spring" ? "SPRING" : "TWEEN";

  return (
    <div style={{ width, height, backgroundColor: "#0d1117", position: "relative" }}>
      {/* Target indicator line */}
      <div
        style={{
          position: "absolute",
          left: Math.round(target) - 1,
          top: 10,
          width: 2,
          height: height - 20,
          backgroundColor: "rgba(255,255,255,0.1)",
        }}
      />

      {/* Spring/Tween-animated ball */}
      <div
        style={{
          position: "absolute",
          left: cx - cr,
          top: cy - cr,
          width: cr * 2,
          height: cr * 2,
          borderRadius: cr,
          backgroundColor: ballColor,
        }}
      />

      {/* Label — tap to toggle animation mode */}
      <div style={{ position: "absolute", left: 8, top: 4 }}>
        <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 10 }}>
          {label} {isAnimating ? "\u25CF" : "\u25CB"}
        </span>
      </div>
    </div>
  );
}

export const springDialAction = defineAction({
  uuid: "com.example.react-animation.spring-dial",
  touchStrip: SpringDial,
});
