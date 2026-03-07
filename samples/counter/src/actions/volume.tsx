import { useState } from "react";
import {
  defineAction,
  useDialRotate,
  useDialDown,
  useDialHint,
  ProgressBar,
  tw,
} from "@fcannizzaro/streamdeck-react";

// ── Volume Dial ─────────────────────────────────────────────────────
// Rotate to adjust volume, press to mute/unmute.

function VolumeDial() {
  const [volume, setVolume] = useState(50);
  const [muted, setMuted] = useState(false);

  useDialHint({
    rotate: "Adjust volume",
    press: muted ? "Unmute" : "Mute",
  });

  useDialRotate(({ ticks }) => {
    if (!muted) {
      setVolume((v) => Math.max(0, Math.min(100, v + ticks * 2)));
    }
  });

  useDialDown(() => {
    setMuted((m) => !m);
  });

  return (
    <div
      className={tw(
        "flex flex-col items-center justify-center w-full h-full gap-4 p-2",
        muted ? "bg-[#4a0000]" : "bg-[#1a1a1a]",
      )}
    >
      <span
        className={tw(
          "text-[24px] font-bold",
          muted ? "text-[#ff4444]" : "text-white",
        )}
      >
        {muted ? "MUTE" : `${volume}%`}
      </span>
      <ProgressBar
        value={muted ? 0 : volume}
        height={4}
        color={muted ? "#ff4444" : "#4CAF50"}
        background="#333"
        borderRadius={2}
      />
    </div>
  );
}

export const volumeAction = defineAction({
  uuid: "com.example.react-counter.volume",
  dial: VolumeDial,
});
