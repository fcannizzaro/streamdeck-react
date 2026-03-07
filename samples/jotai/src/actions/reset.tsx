import { useSetAtom } from "jotai";
import { defineAction, useKeyDown, tw } from "@fcannizzaro/streamdeck-react";
import { resetAtom } from "../store.ts";

function ResetAtomKey() {
  const reset = useSetAtom(resetAtom);

  useKeyDown(() => {
    reset();
  });

  return (
    <div
      className={tw(
        "flex h-full w-full flex-col items-center justify-center gap-1",
        "bg-[#1b1b1e]",
      )}
    >
      <span className="text-[12px] font-semibold uppercase tracking-[0.22em] text-white/55">
        Store
      </span>
      <span className="text-[24px] font-bold text-[#6fffe9]">Reset</span>
      <span className="text-[10px] text-white/60">plugin wrapper</span>
    </div>
  );
}

export const resetAction = defineAction({
  uuid: "com.example.react-jotai.reset",
  key: ResetAtomKey,
});
