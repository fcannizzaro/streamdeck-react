import type { ExamplePreset, ScaffoldOptions } from "../templates.js";
import { createAdapterFiles, createPluginEntrypoint } from "./shared.js";

// ── Zustand Example ─────────────────────────────────────────────────
//
// Shared state across keys via Zustand — three actions read/write a
// single store: display, increment, and reset.

function createZustandStore(): string {
  return [
    'import { create } from "zustand";',
    "",
    "type CounterStore = {",
    "  count: number;",
    "  increment: () => void;",
    "  reset: () => void;",
    "};",
    "",
    "export const useCounterStore = create<CounterStore>((set) => ({",
    "  count: 0,",
    "  increment: () => {",
    "    set((state) => ({ count: state.count + 1 }));",
    "  },",
    "  reset: () => {",
    "    set({ count: 0 });",
    "  },",
    "}));",
    "",
  ].join("\n");
}

function createZustandDisplayAction(pluginUuid: string): string {
  return [
    'import { defineAction, tw } from "@fcannizzaro/streamdeck-react";',
    'import { useCounterStore } from "../store.ts";',
    "",
    "function SharedDisplayKey() {",
    "  const count = useCounterStore((state) => state.count);",
    "",
    "  return (",
    "    <div",
    "      className={tw(",
    '        "flex h-full w-full flex-col items-center justify-center gap-1",',
    '        "bg-linear-to-br from-[#12343b] via-[#1f7a8c] to-[#bfdbf7]",',
    "      )}",
    "    >",
    '      <span className="text-[11px] font-medium uppercase tracking-[0.24em] text-white/70">',
    "        Shared",
    "      </span>",
    '      <span className="text-[34px] font-bold text-white">{count}</span>',
    '      <span className="text-[10px] text-white/75">updates everywhere</span>',
    "    </div>",
    "  );",
    "}",
    "",
    "export const displayAction = defineAction({",
    `  uuid: "${pluginUuid}.display",`,
    "  key: SharedDisplayKey,",
    "  info: {",
    '    name: "Shared Display",',
    '    icon: "imgs/actions/display",',
    "  },",
    "});",
    "",
  ].join("\n");
}

function createZustandIncrementAction(pluginUuid: string): string {
  return [
    'import { defineAction, tw, useKeyDown } from "@fcannizzaro/streamdeck-react";',
    'import { useCounterStore } from "../store.ts";',
    "",
    "function IncrementKey() {",
    "  const count = useCounterStore((state) => state.count);",
    "  const increment = useCounterStore((state) => state.increment);",
    "",
    "  useKeyDown(() => {",
    "    increment();",
    "  });",
    "",
    "  return (",
    "    <div",
    "      className={tw(",
    '        "flex h-full w-full flex-col items-center justify-center gap-1",',
    '        "bg-linear-to-br from-[#ee964b] to-[#f95738]",',
    "      )}",
    "    >",
    '      <span className="text-[12px] font-semibold uppercase tracking-[0.22em] text-white/75">Add</span>',
    '      <span className="text-[30px] font-black text-white">+1</span>',
    '      <span className="text-[11px] text-white/80">count {count}</span>',
    "    </div>",
    "  );",
    "}",
    "",
    "export const incrementAction = defineAction({",
    `  uuid: "${pluginUuid}.increment",`,
    "  key: IncrementKey,",
    "  info: {",
    '    name: "Increment",',
    '    icon: "imgs/actions/increment",',
    "  },",
    "});",
    "",
  ].join("\n");
}

function createZustandResetAction(pluginUuid: string): string {
  return [
    'import { defineAction, tw, useKeyDown } from "@fcannizzaro/streamdeck-react";',
    'import { useCounterStore } from "../store.ts";',
    "",
    "function ResetKey() {",
    "  const reset = useCounterStore((state) => state.reset);",
    "",
    "  useKeyDown(() => {",
    "    reset();",
    "  });",
    "",
    "  return (",
    "    <div",
    "      className={tw(",
    '        "flex h-full w-full flex-col items-center justify-center gap-1",',
    '        "bg-[#2f2d2e]",',
    "      )}",
    "    >",
    '      <span className="text-[12px] font-semibold uppercase tracking-[0.22em] text-white/60">Sync</span>',
    '      <span className="text-[24px] font-bold text-[#f4f1de]">Reset</span>',
    '      <span className="text-[10px] text-white/65">shared store</span>',
    "    </div>",
    "  );",
    "}",
    "",
    "export const resetAction = defineAction({",
    `  uuid: "${pluginUuid}.reset",`,
    "  key: ResetKey,",
    "  info: {",
    '    name: "Reset",',
    '    icon: "imgs/actions/reset",',
    "  },",
    "});",
    "",
  ].join("\n");
}

export function zustandPreset(): ExamplePreset {
  return {
    dependencies: {
      zustand: "^5.0.8",
    },
    actions: [
      { id: "display", name: "Shared Display", colors: { from: "#12343b", to: "#bfdbf7" } },
      { id: "increment", name: "Increment", colors: { from: "#ee964b", to: "#f95738" } },
      { id: "reset", name: "Reset", colors: { from: "#2f2d2e", to: "#575761" } },
    ],
    files: (options: ScaffoldOptions) => ({
      "src/store.ts": createZustandStore(),
      "src/actions/display.tsx": createZustandDisplayAction(options.pluginUuid),
      "src/actions/increment.tsx": createZustandIncrementAction(options.pluginUuid),
      "src/actions/reset.tsx": createZustandResetAction(options.pluginUuid),
      ...createAdapterFiles(options.adapter),
      "src/plugin.ts": createPluginEntrypoint(
        ["displayAction", "incrementAction", "resetAction"],
        undefined,
        options.adapter,
      ),
    }),
  };
}
