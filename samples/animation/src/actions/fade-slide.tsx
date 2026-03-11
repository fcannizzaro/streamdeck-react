import { useState } from "react";
import { defineAction, useKeyDown, useTween, tw } from "@fcannizzaro/streamdeck-react";

// ── Fade Slide Key ──────────────────────────────────────────────────
// Demonstrates tween-based animation: cycles through labels with fade + hue shift.

const LABELS = ["HELLO", "WORLD", "REACT", "DECK"];
const COLORS = ["#667eea", "#764ba2", "#f093fb", "#4facfe"];

function FadeSlide() {
  const [index, setIndex] = useState(0);

  useKeyDown(() => {
    setIndex((i) => (i + 1) % LABELS.length);
  });

  // Tween background hue when cycling
  const { value: bg } = useTween(index * 90, {
    duration: 400,
    easing: "easeOutCubic",
  });

  return (
    <div
      className={tw("flex flex-col items-center justify-center w-full h-full")}
      style={{ backgroundColor: `hsl(${Math.round(bg) % 360}, 50%, 25%)` }}
    >
      <span className="text-white text-[28px] font-bold">{LABELS[index]}</span>
      <div className={tw("flex gap-1 mt-2")}>
        {LABELS.map((_, i) => (
          <div
            key={i}
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: i === index ? COLORS[i] : "rgba(255,255,255,0.2)",
            }}
          />
        ))}
      </div>
      <span className="text-white/30 text-[8px] mt-1">TAP TO CYCLE</span>
    </div>
  );
}

export const fadeSlideAction = defineAction({
  uuid: "com.example.react-animation.fade-slide",
  key: FadeSlide,
});
