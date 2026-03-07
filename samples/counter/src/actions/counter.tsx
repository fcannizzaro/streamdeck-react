import { useState } from "react";
import { defineAction, useKeyDown, useKeyUp, useTap, useLongPress, useDoubleTap, useSettings, tw } from "@fcannizzaro/streamdeck-react";

type CounterSettings = { count: number };

// ── Counter Key ─────────────────────────────────────────────────────
// Single tap increments, double tap decrements, long press resets.
// The count is persisted in the action settings.

function CounterKey() {
  const [settings, setSettings] = useSettings<CounterSettings>();
  const count = settings.count ?? 0;
  const [pressed, setPressed] = useState(false);

  const updateCount = (next: number) => {
    setSettings({ count: next });
  };

  useKeyDown(() => {
    setPressed(true);
  });

  useKeyUp(() => {
    setPressed(false);
  });

  useTap(() => {
    updateCount(count + 1);
  });

  useDoubleTap(() => {
    updateCount(Math.max(0, count - 1));
  });

  useLongPress(() => {
    updateCount(0);
  });

  return (
    <div
      className={tw(
        "flex flex-col items-center justify-center w-full h-full gap-0",
        pressed
          ? "bg-linear-to-br from-[#764ba2] to-[#667eea]"
          : "bg-linear-to-br from-[#667eea] to-[#764ba2]",
      )}
    >
      <span className="text-white/70 text-[12px] font-medium">COUNT</span>
      <span className="text-white text-[64px] font-bold font-[SplineSansMono]">{count}</span>
    </div>
  );
}

export const counterAction = defineAction<CounterSettings>({
  uuid: "com.example.react-counter.counter",
  key: CounterKey,
  defaultSettings: { count: 0 },
});
