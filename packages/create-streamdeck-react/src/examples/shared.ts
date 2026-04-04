// ── Shared Helpers for Example Presets ───────────────────────────────
//
// Functions shared across all example presets: adapter scaffolding and
// plugin entrypoint generation.  Extracted here to avoid circular
// runtime imports between templates.ts and example files.

import type { Adapter } from "../templates.js";

// ── Custom Adapter Scaffolding ────────────────────────────────────────
//
// When adapter is "custom", generate a sample StreamDeckAdapter
// implementation file (src/adapter.ts).  For "physical" no extra files
// are needed because physicalDevice() is imported from the library.

export function createAdapterFiles(adapter: Adapter): Record<string, string> {
  if (adapter !== "custom") return {};
  return { "src/adapter.ts": createCustomAdapter() };
}

function createCustomAdapter(): string {
  return [
    'import type { StreamDeckAdapter } from "@fcannizzaro/streamdeck-react";',
    "",
    "// ── Custom Adapter ────────────────────────────────────────────────",
    "//",
    "// Implement the StreamDeckAdapter interface to connect your plugin",
    "// to a custom backend (WebSocket server, test harness, web preview,",
    "// etc.).  Replace the placeholder implementations below with your",
    "// own logic.",
    "",
    "export function myAdapter(): StreamDeckAdapter {",
    "  return {",
    '    pluginUUID: "com.example.custom-adapter",',
    "",
    "    // ── Connection lifecycle ──────────────────────────────────",
    "    async connect() {",
    '      console.log("[adapter] connected");',
    "    },",
    "",
    "    // ── Global settings ───────────────────────────────────────",
    "    async getGlobalSettings() {",
    "      return {};",
    "    },",
    "",
    "    async setGlobalSettings(_settings) {",
    "      // persist global settings",
    "    },",
    "",
    "    onGlobalSettingsChanged(_callback) {",
    "      // subscribe to external global settings changes",
    "    },",
    "",
    "    // ── Action registration ───────────────────────────────────",
    "    registerAction(uuid, callbacks) {",
    "      console.log(`[adapter] registered action: ${uuid}`);",
    "",
    "      // Example: simulate a willAppear event after registration",
    "      // callbacks.onWillAppear({",
    "      //   action: { ... },",
    '      //   payload: { settings: {}, controller: "Keypad", isInMultiAction: false },',
    "      // });",
    "      void callbacks;",
    "    },",
    "",
    "    // ── SDK utilities ─────────────────────────────────────────",
    "    async openUrl(url) {",
    "      console.log(`[adapter] open URL: ${url}`);",
    "    },",
    "",
    "    async switchToProfile(_deviceId, _profile) {",
    "      // switch active Stream Deck profile",
    "    },",
    "",
    "    async sendToPropertyInspector(_payload) {",
    "      // forward payload to Property Inspector",
    "    },",
    "  };",
    "}",
    "",
  ].join("\n");
}

// ── Plugin Entrypoint ─────────────────────────────────────────────────

export function createPluginEntrypoint(
  actionExports: string[],
  wrapperName?: string,
  adapter?: Adapter,
): string {
  const imports = actionExports
    .map(
      (actionName) =>
        `import { ${actionName} } from "./actions/${stripActionSuffix(actionName)}.tsx";`,
    )
    .join("\n");
  const wrapperImport = wrapperName ? `import { ${wrapperName} } from "./wrapper.tsx";\n` : "";
  const wrapperConfig = wrapperName ? `,\n  wrapper: ${wrapperName}` : "";

  // When using a custom adapter, import from the local adapter file
  // and pass it to createPlugin.  The physical adapter is the default
  // (physicalDevice()) so it needs an explicit import + config entry.
  const useCustomAdapter = adapter === "custom";
  const adapterImport = useCustomAdapter
    ? 'import { myAdapter } from "./adapter.ts";\n'
    : 'import { physicalDevice } from "@fcannizzaro/streamdeck-react";\n';
  const adapterConfig = useCustomAdapter
    ? ",\n  adapter: myAdapter()"
    : ",\n  adapter: physicalDevice()";

  return [
    'import { createPlugin, googleFont } from "@fcannizzaro/streamdeck-react";',
    imports,
    wrapperImport.trimEnd(),
    adapterImport.trimEnd(),
    "",
    'const inter = await googleFont("Inter");',
    "",
    "const plugin = createPlugin({",
    "  fonts: [inter],",
    `  actions: [${actionExports.join(", ")}]${wrapperConfig}${adapterConfig},`,
    "});",
    "",
    "await plugin.connect();",
    "",
  ].join("\n");
}

function stripActionSuffix(actionName: string): string {
  return actionName.replace(/Action$/, "");
}
