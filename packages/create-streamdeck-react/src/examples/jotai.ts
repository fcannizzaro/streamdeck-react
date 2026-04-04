import type { ExamplePreset, ScaffoldOptions } from "../templates.js";
import { createAdapterFiles, createPluginEntrypoint } from "./shared.js";

// ── Jotai Example ───────────────────────────────────────────────────
//
// Shared atom state via Jotai with a plugin-level Provider wrapper.
// Three actions (display, increment, reset) share atoms through a
// common store exposed by the wrapper component.

function createJotaiStore(): string {
  return [
    'import { atom, createStore } from "jotai";',
    "",
    "export const store = createStore();",
    "",
    "export const countAtom = atom(0);",
    "",
    "export const incrementAtom = atom(null, (get, set) => {",
    "  set(countAtom, get(countAtom) + 1);",
    "});",
    "",
    "export const resetAtom = atom(null, (_get, set) => {",
    "  set(countAtom, 0);",
    "});",
    "",
  ].join("\n");
}

function createJotaiWrapper(): string {
  return [
    'import type { ReactNode } from "react";',
    'import { Provider } from "jotai";',
    'import { store } from "./store.ts";',
    "",
    "type JotaiWrapperProps = {",
    "  children?: ReactNode;",
    "};",
    "",
    "export function JotaiWrapper({ children }: JotaiWrapperProps) {",
    "  return <Provider store={store}>{children}</Provider>;",
    "}",
    "",
  ].join("\n");
}

function createJotaiDisplayAction(pluginUuid: string): string {
  return [
    'import { useAtomValue } from "jotai";',
    'import { defineAction, tw } from "@fcannizzaro/streamdeck-react";',
    'import { countAtom } from "../store.ts";',
    "",
    "function AtomDisplayKey() {",
    "  const count = useAtomValue(countAtom);",
    "",
    "  return (",
    "    <div",
    "      className={tw(",
    '        "flex h-full w-full flex-col items-center justify-center gap-1",',
    '        "bg-gradient-to-br from-[#0b132b] via-[#1c2541] to-[#3a506b]",',
    "      )}",
    "    >",
    '      <span className="text-[11px] font-medium uppercase tracking-[0.24em] text-[#9fb3c8]">Atom</span>',
    '      <span className="text-[34px] font-bold text-white">{count}</span>',
    '      <span className="text-[10px] text-white/65">shared by wrapper</span>',
    "    </div>",
    "  );",
    "}",
    "",
    "export const displayAction = defineAction({",
    `  uuid: "${pluginUuid}.display",`,
    "  key: AtomDisplayKey,",
    "  info: {",
    '    name: "Atom Display",',
    '    icon: "imgs/actions/display",',
    "  },",
    "});",
    "",
  ].join("\n");
}

function createJotaiIncrementAction(pluginUuid: string): string {
  return [
    'import { useSetAtom } from "jotai";',
    'import { defineAction, tw, useKeyDown } from "@fcannizzaro/streamdeck-react";',
    'import { incrementAtom } from "../store.ts";',
    "",
    "function IncrementAtomKey() {",
    "  const increment = useSetAtom(incrementAtom);",
    "",
    "  useKeyDown(() => {",
    "    increment();",
    "  });",
    "",
    "  return (",
    "    <div",
    "      className={tw(",
    '        "flex h-full w-full flex-col items-center justify-center gap-1",',
    '        "bg-gradient-to-br from-[#5bc0be] to-[#6fffe9]",',
    "      )}",
    "    >",
    '      <span className="text-[12px] font-semibold uppercase tracking-[0.22em] text-[#0b132b]/70">',
    "        Pulse",
    "      </span>",
    '      <span className="text-[30px] font-black text-[#0b132b]">+1</span>',
    '      <span className="text-[10px] text-[#0b132b]/70">shared atom write</span>',
    "    </div>",
    "  );",
    "}",
    "",
    "export const incrementAction = defineAction({",
    `  uuid: "${pluginUuid}.increment",`,
    "  key: IncrementAtomKey,",
    "  info: {",
    '    name: "Increment Atom",',
    '    icon: "imgs/actions/increment",',
    "  },",
    "});",
    "",
  ].join("\n");
}

function createJotaiResetAction(pluginUuid: string): string {
  return [
    'import { useSetAtom } from "jotai";',
    'import { defineAction, tw, useKeyDown } from "@fcannizzaro/streamdeck-react";',
    'import { resetAtom } from "../store.ts";',
    "",
    "function ResetAtomKey() {",
    "  const reset = useSetAtom(resetAtom);",
    "",
    "  useKeyDown(() => {",
    "    reset();",
    "  });",
    "",
    "  return (",
    "    <div",
    "      className={tw(",
    '        "flex h-full w-full flex-col items-center justify-center gap-1",',
    '        "bg-[#1b1b1e]",',
    "      )}",
    "    >",
    '      <span className="text-[12px] font-semibold uppercase tracking-[0.22em] text-white/55">Store</span>',
    '      <span className="text-[24px] font-bold text-[#6fffe9]">Reset</span>',
    '      <span className="text-[10px] text-white/60">plugin wrapper</span>',
    "    </div>",
    "  );",
    "}",
    "",
    "export const resetAction = defineAction({",
    `  uuid: "${pluginUuid}.reset",`,
    "  key: ResetAtomKey,",
    "  info: {",
    '    name: "Reset Atom",',
    '    icon: "imgs/actions/reset",',
    "  },",
    "});",
    "",
  ].join("\n");
}

export function jotaiPreset(): ExamplePreset {
  return {
    dependencies: {
      jotai: "^2.12.5",
    },
    actions: [
      { id: "display", name: "Atom Display", colors: { from: "#0b132b", to: "#3a506b" } },
      { id: "increment", name: "Increment Atom", colors: { from: "#5bc0be", to: "#6fffe9" } },
      { id: "reset", name: "Reset Atom", colors: { from: "#1b1b1e", to: "#2b2d42" } },
    ],
    files: (options: ScaffoldOptions) => ({
      "src/store.ts": createJotaiStore(),
      "src/wrapper.tsx": createJotaiWrapper(),
      "src/actions/display.tsx": createJotaiDisplayAction(options.pluginUuid),
      "src/actions/increment.tsx": createJotaiIncrementAction(options.pluginUuid),
      "src/actions/reset.tsx": createJotaiResetAction(options.pluginUuid),
      ...createAdapterFiles(options.adapter),
      "src/plugin.ts": createPluginEntrypoint(
        ["displayAction", "incrementAction", "resetAction"],
        "JotaiWrapper",
        options.adapter,
      ),
    }),
  };
}
