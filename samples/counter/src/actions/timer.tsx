import { useState, useCallback } from "react";
import { defineAction, useInterval, useKeyDown, tw } from "@fcannizzaro/streamdeck-react";

// ── Timer Key ───────────────────────────────────────────────────────
// Start/stop timer on press, displays elapsed time.

function TimerKey() {
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);

  useKeyDown(() => {
    setRunning((r) => !r);
  });

  useInterval(() => {
    setElapsed((e) => e + 100);
  }, running ? 100 : null);

  const formatTime = useCallback((ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    const tenths = Math.floor((ms % 1000) / 100);
    return `${minutes}:${String(secs).padStart(2, "0")}.${tenths}`;
  }, []);

  return (
    <div
      className={tw(
        "flex flex-col items-center justify-center w-full h-full gap-1",
        running ? "bg-[#1b5e20]" : "bg-[#212121]",
      )}
    >
      <span className="text-white/60 text-[10px] font-medium">
        {running ? "RUNNING" : "STOPPED"}
      </span>
      <span className="text-white text-[22px] font-bold">
        {formatTime(elapsed)}
      </span>
    </div>
  );
}

export const timerAction = defineAction({
  uuid: "com.example.react-counter.timer",
  key: TimerKey,
});
