import { defineAction, useKeyDown, tw } from "@fcannizzaro/streamdeck-react";
import { useCounterStore } from "../store.ts";

function ResetKey() {
  const reset = useCounterStore((state) => state.reset);

  useKeyDown(() => {
    reset();
  });

  return (
    <div
      className={tw(
        "flex h-full w-full flex-col items-center justify-center gap-1",
        "bg-[#2f2d2e]",
      )}
    >
      <span className="text-[12px] font-semibold uppercase tracking-[0.22em] text-white/60">
        Sync
      </span>
      <span className="text-[24px] font-bold text-[#f4f1de]">Reset</span>
      <span className="text-[10px] text-white/65">shared store</span>
    </div>
  );
}

export const resetAction = defineAction({
  uuid: "com.example.react-zustand.reset",
  key: ResetKey,
});
