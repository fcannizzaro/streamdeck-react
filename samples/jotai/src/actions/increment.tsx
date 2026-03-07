import { useSetAtom } from "jotai";
import { defineAction, useKeyDown, tw } from "@fcannizzaro/streamdeck-react";
import { incrementAtom } from "../store";

function IncrementAtomKey() {
  const increment = useSetAtom(incrementAtom);

  useKeyDown(() => {
    increment();
  });

  return (
    <div
      className={tw(
        "flex h-full w-full flex-col items-center justify-center gap-1",
        "bg-gradient-to-br from-[#5bc0be] to-[#6fffe9]",
      )}
    >
      <span className="text-[12px] font-semibold uppercase tracking-[0.22em] text-[#0b132b]/70">
        Pulse
      </span>
      <span className="text-[30px] font-black text-[#0b132b]">+1</span>
      <span className="text-[10px] text-[#0b132b]/70">shared atom write</span>
    </div>
  );
}

export const incrementAction = defineAction({
  uuid: "com.example.react-jotai.increment",
  key: IncrementAtomKey,
});
