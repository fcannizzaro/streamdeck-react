import { defineAction, useKeyDown, tw } from "@fcannizzaro/streamdeck-react";
import { useCounterStore } from "../store";

function IncrementKey() {
  const count = useCounterStore((state) => state.count);
  const increment = useCounterStore((state) => state.increment);

  useKeyDown(() => {
    increment();
  });

  return (
    <div
      className={tw(
        "flex h-full w-full flex-col items-center justify-center gap-1",
        "bg-linear-to-br from-[#ee964b] to-[#f95738]",
      )}
    >
      <span className="text-[12px] font-semibold uppercase tracking-[0.22em] text-white/75">
        Add
      </span>
      <span className="text-[30px] font-black text-white">+1</span>
      <span className="text-[11px] text-white/80">count {count}</span>
    </div>
  );
}

export const incrementAction = defineAction({
  uuid: "com.example.react-zustand.increment",
  key: IncrementKey,
});
