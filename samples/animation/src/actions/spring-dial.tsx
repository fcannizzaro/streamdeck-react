import { useState } from "react";
import {
  defineAction,
  useTouchStrip,
  useTouchStripDialRotate,
  useTouchStripDialDown,
  useTouchStripTap,
  useSpring,
  SpringPresets,
  tw,
} from "@fcannizzaro/streamdeck-react";

// ── Spring Dial TouchStrip ──────────────────────────────────────────
// Demonstrates spring physics on the touchstrip: a ball follows dial rotation
// with bouncy spring dynamics. Press to toggle ball size.

function SpringDial() {
  const { width, height } = useTouchStrip();
  const [target, setTarget] = useState(width / 2);
  const [big, setBig] = useState(false);

  // Spring-animated horizontal position
  const { value: x, isAnimating } = useSpring(target, SpringPresets.wobbly);

  // Spring-animated radius on press
  const { value: r } = useSpring(big ? 35 : 18, SpringPresets.stiff);

  useTouchStripDialRotate(({ ticks }) => {
    setTarget((t) => Math.max(20, Math.min(width - 20, t + ticks * 15)));
  });

  useTouchStripDialDown(() => {
    setBig((b) => !b);
  });

  useTouchStripTap(({ tapPos, hold }) => {
    setTarget(Math.max(20, Math.min(width - 20, tapPos[0])));
    if (hold) {
      setBig((b) => !b);
    }
  });

  const ballColor = isAnimating ? "#ff6b6b" : "#4ecdc4";
  const cx = Math.round(x);
  const cr = Math.round(r);
  const cy = Math.round(height / 2);

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

      {/* Spring-animated ball */}
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

      {/* Label */}
      <div style={{ position: "absolute", left: 8, top: 4 }}>
        <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 10 }}>
          SPRING {isAnimating ? "\u25CF" : "\u25CB"}
        </span>
      </div>
    </div>
  );
}

export const springDialAction = defineAction({
  uuid: "com.example.react-animation.spring-dial",
  touchStrip: SpringDial,
  touchStripFPS: 60,
});
