import { useAtomValue } from "jotai";
import { defineAction, tw } from "@fcannizzaro/streamdeck-react";
import { countAtom } from "../store.ts";

function AtomDisplayKey() {
  const count = useAtomValue(countAtom);

  return (
    <div
      className={tw(
        "flex h-full w-full flex-col items-center justify-center gap-1",
        "bg-gradient-to-br from-[#0b132b] via-[#1c2541] to-[#3a506b]",
      )}
    >
      <span className="text-[11px] font-medium uppercase tracking-[0.24em] text-[#9fb3c8]">
        Atom
      </span>
      <span className="text-[34px] font-bold text-white">{count}</span>
      <span className="text-[10px] text-white/65">shared by wrapper</span>
    </div>
  );
}

export const displayAction = defineAction({
  uuid: "com.example.react-jotai.display",
  key: AtomDisplayKey,
});
