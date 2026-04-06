import { useState } from "react";
import { defineAction, useKeyDown, tw } from "@fcannizzaro/streamdeck-react";

// ── Themed Key ──────────────────────────────────────────────────────
// Demonstrates CSS stylesheet theming via @tailwindcss/vite.
//
// The theme.css file defines custom color tokens via Tailwind v4's
// `@theme` block:
//   --color-primary, --color-surface, --color-accent, etc.
//
// These become first-class Tailwind utilities: `bg-primary`,
// `text-accent`, `bg-surface-light`, etc.  No `var()` needed.
//
// Press the key to cycle between three visual states.

type ThemeState = "idle" | "active" | "accent";

const stateLabels: Record<ThemeState, string> = {
  idle: "IDLE",
  active: "ACTIVE",
  accent: "ACCENT",
};

const stateIcons: Record<ThemeState, string> = {
  idle: "\u25CB", // ○
  active: "\u25CF", // ●
  accent: "\u2605", // ★
};

const states: ThemeState[] = ["idle", "active", "accent"];

function ThemedKey() {
  const [state, setState] = useState<ThemeState>("idle");

  useKeyDown(() => {
    setState((s) => {
      const idx = states.indexOf(s);
      return states[(idx + 1) % states.length]!;
    });
  });

  return (
    <div
      className={tw(
        "flex flex-col items-center justify-center w-full h-full gap-1",
        state === "idle" && "bg-surface",
        state === "active" && "bg-primary",
        state === "accent" && "bg-accent",
      )}
    >
      <span
        className={tw("text-[28px]", state === "accent" ? "text-surface" : "text-accent-light")}
      >
        {stateIcons[state]}
      </span>
      <span
        className={tw("text-[18px] font-bold", state === "accent" ? "text-surface" : "text-white")}
      >
        {stateLabels[state]}
      </span>
      <span className="text-muted text-[9px] font-medium">CSS THEME</span>
    </div>
  );
}

export const themedAction = defineAction({
  uuid: "com.example.react-basic.themed",
  key: ThemedKey,
  info: {
    name: "Themed",
    icon: "imgs/actions/counter",
    tooltip: "Demonstrates CSS stylesheet theming with @tailwindcss/vite.",
  },
});
