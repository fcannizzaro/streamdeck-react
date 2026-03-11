import { useState } from "react";
import {
  defineAction,
  useKeyDown,
  useKeyUp,
  useSpring,
  SpringPresets,
  tw,
} from "@fcannizzaro/streamdeck-react";

// ── Spring Bounce Key ───────────────────────────────────────────────
// Demonstrates spring physics: wobbly scale on press + hue shift on count.

function SpringBounce() {
  const [pressed, setPressed] = useState(false);
  const [count, setCount] = useState(0);

  useKeyDown(() => {
    setPressed(true);
    setCount((c) => c + 1);
  });

  useKeyUp(() => setPressed(false));

  // Wobbly scale spring — bounces on press
  const { value: scale } = useSpring(pressed ? 0.8 : 1, {
    ...SpringPresets.wobbly,
    tension: 300,
  });

  // Gentle background hue shift based on count
  const { value: hue } = useSpring((count * 40) % 360, SpringPresets.gentle);

  const size = Math.round(scale * 100);

  return (
    <div
      className={tw("flex items-center justify-center w-full h-full")}
      style={{ backgroundColor: `hsl(${Math.round(hue)}, 60%, 25%)` }}
    >
      <div
        className={tw("flex flex-col items-center justify-center")}
        style={{ width: `${size}%`, height: `${size}%` }}
      >
        <span className="text-white/50 text-[10px] font-medium">SPRING</span>
        <span className="text-white text-[48px] font-bold">{count}</span>
      </div>
    </div>
  );
}

export const springBounceAction = defineAction({
  uuid: "com.example.react-animation.spring-bounce",
  key: SpringBounce,
});
