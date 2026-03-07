import { useState } from "react";
import { defineAction, useKeyDown, useKeyUp, tw } from "@fcannizzaro/streamdeck-react";

// ── Counter Key ─────────────────────────────────────────────────────
// Increments on press, shows the count.

function CounterKey() {
  const [count, setCount] = useState(0);
  const [pressed, setPressed] = useState(false);

  useKeyDown(() => {
    setCount((c) => c + 1);
    setPressed(true);
  });

  useKeyUp(() => {
    setPressed(false);
  });

  return (
    <div
      className={tw(
        "flex flex-col items-center justify-center w-full h-full gap-1",
        pressed
          ? "bg-gradient-to-br from-[#764ba2] to-[#667eea]"
          : "bg-gradient-to-br from-[#667eea] to-[#764ba2]",
      )}
    >
      <span className="text-white/70 text-[12px] font-medium">COUNT</span>
      <span className="text-white text-[36px] font-bold">{count}</span>
    </div>
  );
}

export const counterAction = defineAction({
  uuid: "com.example.react-counter.counter",
  key: CounterKey,
});
