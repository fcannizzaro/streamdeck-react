import { describe, expect, test } from "bun:test";
import {
  validateManifestConfig,
  buildManifestJson,
  generateManifestJsonString,
} from "@/manifest-gen";
import type { ManifestConfig, ManifestActionSource } from "@/manifest-types";

// ── Fixtures ────────────────────────────────────────────────────────

// Dummy component stand-in (just needs to be truthy for controller derivation)
const KeyComponent = (() => null) as unknown;
const DialComponent = (() => null) as unknown;
const TouchStripComponent = (() => null) as unknown;

const counterAction: ManifestActionSource = {
  uuid: "com.example.my-plugin.counter",
  key: KeyComponent,
  info: {
    name: "Counter",
    icon: "imgs/actions/counter",
  },
};

const MINIMAL_CONFIG: ManifestConfig = {
  uuid: "com.example.my-plugin",
  name: "My Plugin",
  author: "Test Author",
  description: "A test plugin",
  icon: "imgs/plugin-icon",
  version: "1.0.0.0",
  actions: [counterAction],
};

const keyAction: ManifestActionSource = {
  uuid: "com.example.full.keypad",
  key: KeyComponent,
  info: {
    name: "Key Action",
    icon: "imgs/actions/key",
    tooltip: "A key action",
    states: [
      { image: "imgs/actions/key-on", title: "ON" },
      { image: "imgs/actions/key-off", title: "OFF" },
    ],
  },
};

const dialAction: ManifestActionSource = {
  uuid: "com.example.full.encoder",
  dial: DialComponent,
  info: {
    name: "Dial Action",
    icon: "imgs/actions/dial",
    tooltip: "A dial action",
    encoder: {
      layout: "$A0",
      triggerDescription: {
        rotate: "Adjust volume",
        push: "Mute / Unmute",
        touch: "Select",
      },
    },
  },
};

const bothAction: ManifestActionSource = {
  uuid: "com.example.full.both",
  key: KeyComponent,
  dial: DialComponent,
  info: {
    name: "Both Controllers",
    icon: "imgs/actions/both",
    controllers: ["Keypad", "Encoder"],
    encoder: {
      layout: "layouts/custom.json",
      icon: "imgs/encoder-icon",
      stackColor: "#FF0000",
      background: "imgs/bg",
      triggerDescription: { rotate: "Rotate" },
    },
  },
};

const FULL_CONFIG: ManifestConfig = {
  uuid: "com.example.full",
  name: "Full Plugin",
  author: "Full Author",
  description: "A full plugin",
  icon: "imgs/plugin-icon",
  version: "2.0.0.0",
  category: "Custom Category",
  categoryIcon: "imgs/custom-category",
  url: "https://example.com",
  supportUrl: "https://support.example.com",
  nodejs: { version: "24", debug: "--inspect=127.0.0.1:8090" },
  os: [
    { platform: "mac", minimumVersion: "14" },
    { platform: "windows", minimumVersion: "11" },
  ],
  sdkVersion: 2,
  software: { minimumVersion: "7.0" },
  actions: [keyAction, dialAction, bothAction],
};

// ── Validation ──────────────────────────────────────────────────────

describe("validateManifestConfig", () => {
  test("passes with valid minimal config", () => {
    const errors = validateManifestConfig(MINIMAL_CONFIG);
    expect(errors).toHaveLength(0);
  });

  test("passes with valid full config", () => {
    const errors = validateManifestConfig(FULL_CONFIG);
    expect(errors).toHaveLength(0);
  });

  test("errors on action UUID without plugin prefix", () => {
    const config: ManifestConfig = {
      ...MINIMAL_CONFIG,
      actions: [
        {
          uuid: "com.other.plugin.action",
          key: KeyComponent,
          info: { name: "Bad", icon: "imgs/bad" },
        },
      ],
    };
    const errors = validateManifestConfig(config);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]!.message).toContain("must be prefixed with plugin UUID");
  });

  test("errors on duplicate action UUIDs", () => {
    const config: ManifestConfig = {
      ...MINIMAL_CONFIG,
      actions: [
        { uuid: "com.example.my-plugin.a", key: KeyComponent, info: { name: "A", icon: "imgs/a" } },
        {
          uuid: "com.example.my-plugin.a",
          key: KeyComponent,
          info: { name: "A Dup", icon: "imgs/a" },
        },
      ],
    };
    const errors = validateManifestConfig(config);
    expect(errors.some((e) => e.message.includes("Duplicate"))).toBe(true);
  });

  test("errors on invalid plugin UUID format", () => {
    const config: ManifestConfig = {
      ...MINIMAL_CONFIG,
      uuid: "INVALID_UUID",
      actions: [],
    };
    const errors = validateManifestConfig(config);
    expect(errors.some((e) => e.field === "uuid")).toBe(true);
  });

  test("calls warn callback for UUID prefix errors", () => {
    const warnings: string[] = [];
    const config: ManifestConfig = {
      ...MINIMAL_CONFIG,
      actions: [
        {
          uuid: "com.wrong.prefix.action",
          key: KeyComponent,
          info: { name: "Bad", icon: "imgs/bad" },
        },
      ],
    };
    validateManifestConfig(config, (msg) => warnings.push(msg));
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain("@fcannizzaro/streamdeck-react");
  });
});

// ── JSON Building ───────────────────────────────────────────────────

describe("buildManifestJson", () => {
  test("produces valid manifest structure with minimal config", () => {
    const json = buildManifestJson(MINIMAL_CONFIG);

    expect(json.$schema).toBe("https://schemas.elgato.com/streamdeck/plugins/manifest.json");
    expect(json.UUID).toBe("com.example.my-plugin");
    expect(json.Name).toBe("My Plugin");
    expect(json.Author).toBe("Test Author");
    expect(json.Description).toBe("A test plugin");
    expect(json.Icon).toBe("imgs/plugin-icon");
    expect(json.Version).toBe("1.0.0.0");
  });

  test("applies auto-derived defaults", () => {
    const json = buildManifestJson(MINIMAL_CONFIG);

    expect(json.CodePath).toBe("bin/plugin.mjs");
    expect(json.SDKVersion).toBe(2);
    expect(json.Software).toEqual({ MinimumVersion: "7.1" });
    expect(json.Nodejs).toEqual({ Version: "24" });
    expect(json.OS).toEqual([
      { Platform: "mac", MinimumVersion: "13" },
      { Platform: "windows", MinimumVersion: "10" },
    ]);
    expect(json.Category).toBe("My Plugin");
    expect(json.CategoryIcon).toBe("imgs/plugin-icon");
  });

  test("respects explicit overrides over defaults", () => {
    const json = buildManifestJson(FULL_CONFIG);

    expect(json.Category).toBe("Custom Category");
    expect(json.CategoryIcon).toBe("imgs/custom-category");
    expect(json.SDKVersion).toBe(2);
    expect(json.Software).toEqual({ MinimumVersion: "7.0" });
    expect(json.Nodejs).toEqual({ Version: "24", Debug: "--inspect=127.0.0.1:8090" });
    expect(json.OS).toEqual([
      { Platform: "mac", MinimumVersion: "14" },
      { Platform: "windows", MinimumVersion: "11" },
    ]);
  });

  test("overrides CodePath with parameter", () => {
    const json = buildManifestJson(MINIMAL_CONFIG, "dist/main.mjs");
    expect(json.CodePath).toBe("dist/main.mjs");
  });

  test("uses config.codePath when no parameter override", () => {
    const config: ManifestConfig = {
      ...MINIMAL_CONFIG,
      codePath: "custom/entry.mjs",
    };
    const json = buildManifestJson(config);
    expect(json.CodePath).toBe("custom/entry.mjs");
  });

  test("includes optional plugin-level fields only when provided", () => {
    const minimal = buildManifestJson(MINIMAL_CONFIG);
    expect(minimal.URL).toBeUndefined();
    expect(minimal.SupportURL).toBeUndefined();
    expect(minimal.PropertyInspectorPath).toBeUndefined();
    expect(minimal.Profiles).toBeUndefined();
    expect(minimal.ApplicationsToMonitor).toBeUndefined();

    const full = buildManifestJson(FULL_CONFIG);
    expect(full.URL).toBe("https://example.com");
    expect(full.SupportURL).toBe("https://support.example.com");
  });

  test("throws when action is missing info", () => {
    const config: ManifestConfig = {
      ...MINIMAL_CONFIG,
      actions: [{ uuid: "com.example.my-plugin.no-info" }],
    };
    expect(() => buildManifestJson(config)).toThrow("missing `info`");
  });
});

// ── Controller Derivation ───────────────────────────────────────────

describe("controller derivation", () => {
  test("derives ['Keypad'] from key-only action", () => {
    const json = buildManifestJson(MINIMAL_CONFIG);
    expect(json.Actions[0].Controllers).toEqual(["Keypad"]);
  });

  test("derives ['Encoder'] from dial-only action", () => {
    const config: ManifestConfig = {
      ...MINIMAL_CONFIG,
      actions: [
        {
          uuid: "com.example.my-plugin.dial",
          dial: DialComponent,
          info: { name: "Dial", icon: "imgs/dial" },
        },
      ],
    };
    const json = buildManifestJson(config);
    expect(json.Actions[0].Controllers).toEqual(["Encoder"]);
  });

  test("derives ['Encoder'] from touchStrip-only action", () => {
    const config: ManifestConfig = {
      ...MINIMAL_CONFIG,
      actions: [
        {
          uuid: "com.example.my-plugin.strip",
          touchStrip: TouchStripComponent,
          info: { name: "Strip", icon: "imgs/strip" },
        },
      ],
    };
    const json = buildManifestJson(config);
    expect(json.Actions[0].Controllers).toEqual(["Encoder"]);
  });

  test("derives ['Keypad', 'Encoder'] from key + dial action", () => {
    const config: ManifestConfig = {
      ...MINIMAL_CONFIG,
      actions: [
        {
          uuid: "com.example.my-plugin.both",
          key: KeyComponent,
          dial: DialComponent,
          info: { name: "Both", icon: "imgs/both" },
        },
      ],
    };
    const json = buildManifestJson(config);
    expect(json.Actions[0].Controllers).toEqual(["Keypad", "Encoder"]);
  });

  test("uses explicit controllers when set on info", () => {
    const json = buildManifestJson(FULL_CONFIG);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const both = json.Actions.find((a: any) => a.UUID === "com.example.full.both");
    expect(both.Controllers).toEqual(["Keypad", "Encoder"]);
  });

  test("falls back to ['Encoder'] from info.encoder when no components set", () => {
    const config: ManifestConfig = {
      ...MINIMAL_CONFIG,
      actions: [
        {
          uuid: "com.example.my-plugin.encoder-info",
          info: {
            name: "Encoder Via Info",
            icon: "imgs/enc",
            encoder: { layout: "$A0" },
          },
        },
      ],
    };
    const json = buildManifestJson(config);
    expect(json.Actions[0].Controllers).toEqual(["Encoder"]);
  });

  test("defaults to ['Keypad'] when no components and no encoder info", () => {
    const config: ManifestConfig = {
      ...MINIMAL_CONFIG,
      actions: [
        {
          uuid: "com.example.my-plugin.bare",
          info: { name: "Bare", icon: "imgs/bare" },
        },
      ],
    };
    const json = buildManifestJson(config);
    expect(json.Actions[0].Controllers).toEqual(["Keypad"]);
  });
});

// ── Action Building ─────────────────────────────────────────────────

describe("action building", () => {
  test("generates default state from icon when no states provided", () => {
    const json = buildManifestJson(MINIMAL_CONFIG);
    expect(json.Actions[0].States).toEqual([{ Image: "imgs/actions/counter" }]);
  });

  test("uses explicit states when provided", () => {
    const json = buildManifestJson(FULL_CONFIG);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const keyAct = json.Actions.find((a: any) => a.UUID === "com.example.full.keypad");
    expect(keyAct.States).toEqual([
      { Image: "imgs/actions/key-on", Title: "ON" },
      { Image: "imgs/actions/key-off", Title: "OFF" },
    ]);
  });

  test("builds Encoder block with TriggerDescription", () => {
    const json = buildManifestJson(FULL_CONFIG);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const enc = json.Actions.find((a: any) => a.UUID === "com.example.full.encoder");
    expect(enc.Encoder).toEqual({
      layout: "$A0",
      TriggerDescription: {
        Rotate: "Adjust volume",
        Push: "Mute / Unmute",
        Touch: "Select",
      },
    });
  });

  test("builds full Encoder block with all optional fields", () => {
    const json = buildManifestJson(FULL_CONFIG);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const both = json.Actions.find((a: any) => a.UUID === "com.example.full.both");
    expect(both.Encoder).toEqual({
      layout: "layouts/custom.json",
      Icon: "imgs/encoder-icon",
      StackColor: "#FF0000",
      background: "imgs/bg",
      TriggerDescription: { Rotate: "Rotate" },
    });
  });

  test("includes Tooltip when provided", () => {
    const json = buildManifestJson(FULL_CONFIG);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const keyAct = json.Actions.find((a: any) => a.UUID === "com.example.full.keypad");
    expect(keyAct.Tooltip).toBe("A key action");
  });

  test("omits Tooltip when not provided", () => {
    const json = buildManifestJson(MINIMAL_CONFIG);
    expect(json.Actions[0].Tooltip).toBeUndefined();
  });
});

// ── Serialization ───────────────────────────────────────────────────

describe("generateManifestJsonString", () => {
  test("produces valid JSON string", () => {
    const str = generateManifestJsonString(MINIMAL_CONFIG);
    const parsed = JSON.parse(str);
    expect(parsed.UUID).toBe("com.example.my-plugin");
    expect(parsed.Actions).toHaveLength(1);
  });

  test("output ends with newline", () => {
    const str = generateManifestJsonString(MINIMAL_CONFIG);
    expect(str.endsWith("\n")).toBe(true);
  });

  test("is formatted with 2-space indentation", () => {
    const str = generateManifestJsonString(MINIMAL_CONFIG);
    const lines = str.split("\n");
    expect(lines[1]).toMatch(/^ {2}"/);
  });
});

// ── Full Round-Trip ─────────────────────────────────────────────────

describe("round-trip", () => {
  test("counter sample manifest matches expected structure", () => {
    const config: ManifestConfig = {
      uuid: "com.example.react-counter",
      name: "React Counter Sample",
      author: "Francesco Saverio Cannizzaro",
      description: "Sample plugin with counter and volume.",
      icon: "imgs/plugin-icon",
      version: "0.0.0.1",
      nodejs: { version: "24", debug: "--inspect=127.0.0.1:8090" },
      actions: [
        {
          uuid: "com.example.react-basic.counter",
          key: KeyComponent,
          info: {
            name: "Counter",
            icon: "imgs/actions/counter",
            tooltip: "A simple counter that increments on each key press.",
          },
        },
        {
          uuid: "com.example.react-basic.volume",
          dial: DialComponent,
          info: {
            name: "Volume",
            icon: "imgs/actions/volume",
            encoder: {
              layout: "$A0",
              triggerDescription: {
                rotate: "Adjust volume",
                push: "Mute / Unmute",
              },
            },
            tooltip: "Adjust volume with the dial, press to mute.",
          },
        },
      ],
    };

    const json = buildManifestJson(config);

    // Plugin-level
    expect(json.UUID).toBe("com.example.react-counter");
    expect(json.Name).toBe("React Counter Sample");

    // Counter action — Controllers derived from key
    const counter = json.Actions[0];
    expect(counter.UUID).toBe("com.example.react-basic.counter");
    expect(counter.Controllers).toEqual(["Keypad"]);
    expect(counter.States).toEqual([{ Image: "imgs/actions/counter" }]);

    // Volume action — Controllers derived from dial
    const volume = json.Actions[1];
    expect(volume.UUID).toBe("com.example.react-basic.volume");
    expect(volume.Controllers).toEqual(["Encoder"]);
    expect(volume.Encoder.layout).toBe("$A0");
    expect(volume.Encoder.TriggerDescription.Rotate).toBe("Adjust volume");
  });
});
