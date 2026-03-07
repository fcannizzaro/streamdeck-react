import { defineAction, tw } from "@fcannizzaro/streamdeck-react";
import { useCounterStore } from "../store";

function SharedDisplayKey() {
  const count = useCounterStore((state) => state.count);

  return (
    <div
      className={tw(
        "flex h-full w-full flex-col items-center justify-center gap-1",
        "bg-linear-to-br from-[#12343b] via-[#1f7a8c] to-[#bfdbf7]",
      )}
    >
      <span className="text-[11px] font-medium uppercase tracking-[0.24em] text-white/70">
        Shared
      </span>
      <span className="text-[34px] font-bold text-white">{count}</span>
      <span className="text-[10px] text-white/75">updates everywhere</span>
    </div>
  );
}

export const displayAction = defineAction({
  uuid: "com.example.react-zustand.display",
  key: SharedDisplayKey,
});
