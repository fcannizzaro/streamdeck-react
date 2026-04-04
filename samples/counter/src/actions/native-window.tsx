import { defineAction, tw, useKeyDown, useWillDisappear } from "@fcannizzaro/streamdeck-react";
import { useRef, useState } from "react";

import { NativeWindow } from "@nativewindow/webview";

// ── Native Window Key ─────────────────────────────────────────────────────
// Single tap increments, double tap decrements, long press resets.

function NativeWindowKey() {
  const [open, setOpen] = useState(false);

  const winRef = useRef<NativeWindow | null>(null);

  useKeyDown(() => {
    if (open) {
      winRef.current?.close?.();
    } else {
      const win = new NativeWindow({
        title: "Stream Deck React Window",
        width: 500,
        height: 500,
        devtools: true,
      });
      win.onPageLoad(() => setOpen(true));
      win.onClose(() => {
        winRef.current = null;
        setOpen(false);
      });
      win.loadHtml(
        `<div style="width:100vw;height:100vh;display:grid;place-items:center">Hello!</div>`,
      );
      winRef.current = win;
    }
  });

  // Clean up the native window when the action disappears from the Stream Deck
  useWillDisappear(() => {
    winRef.current?.close?.();
    winRef.current = null;
  });

  return (
    <div
      className={tw(
        "flex flex-col items-center justify-center w-full h-full gap-0",
        open ? "bg-green-500" : "bg-red-500",
      )}
    >
      <span className="text-white/70 text-[16px] font-medium">Window</span>
      <span className="text-white text-[24px] font-bold font-[SplineSansMono]">
        {open ? "OPEN" : "CLOSED"}
      </span>
    </div>
  );
}

export const nativeWindowAction = defineAction({
  uuid: "com.example.react-counter.native-window",
  key: NativeWindowKey,
  info: {
    name: "NativeWindow",
    icon: "imgs/actions/native-window",
    tooltip: "A simple key that open a @nativewindow/webview using native modules",
  },
});
