import type { ExamplePreset, ScaffoldOptions } from "../templates.js";
import { createAdapterFiles, createPluginEntrypoint } from "./shared.js";

// ── Minimal Example ─────────────────────────────────────────────────
//
// One key action with local state — best starting point to learn the
// basics.  Demonstrates useState, useKeyDown, and Tailwind styling.

function createMinimalAction(pluginUuid: string): string {
  return [
    'import { useState } from "react";',
    'import { defineAction, useKeyDown, tw } from "@fcannizzaro/streamdeck-react";',
    "",
    "function StatusKey() {",
    "  const [live, setLive] = useState(false);",
    "",
    "  useKeyDown(() => {",
    "    setLive((value) => !value);",
    "  });",
    "",
    "  return (",
    "    <div",
    "      className={tw(",
    '        "flex h-full w-full flex-col items-center justify-center gap-2",',
    '        live ? "bg-linear-to-br from-[#0f766e] to-[#164e63]" : "bg-linear-to-br from-[#1f2937] to-[#111827]",',
    "      )}",
    "    >",
    '      <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/70">',
    "        Plugin",
    "      </span>",
    '      <span className="text-[24px] font-black text-white">{live ? "Live" : "Standby"}</span>',
    '      <span className="text-[10px] text-white/65">press to toggle</span>',
    "    </div>",
    "  );",
    "}",
    "",
    "export const statusAction = defineAction({",
    `  uuid: "${pluginUuid}.status",`,
    "  key: StatusKey,",
    "  info: {",
    '    name: "Status",',
    '    icon: "imgs/actions/status",',
    "  },",
    "});",
    "",
  ].join("\n");
}

export function minimalPreset(): ExamplePreset {
  return {
    dependencies: {},
    actions: [
      { id: "status", name: "Status", colors: { from: "#0f766e", to: "#164e63" } },
    ],
    files: (options: ScaffoldOptions) => ({
      "src/actions/status.tsx": createMinimalAction(options.pluginUuid),
      ...createAdapterFiles(options.adapter),
      "src/plugin.ts": createPluginEntrypoint(["statusAction"], undefined, options.adapter),
    }),
  };
}
