import { describe, expect, test } from "bun:test";
import { parse } from "acorn";
import { extractActionsFromAST, extractedToActionSource } from "@/manifest-extract";
import type { ExtractedAction } from "@/manifest-extract";

// ── Helpers ─────────────────────────────────────────────────────────

function parseCode(code: string): Record<string, unknown> {
  return parse(code, {
    ecmaVersion: "latest",
    sourceType: "module",
  }) as unknown as Record<string, unknown>;
}

function extractFromCode(code: string): ExtractedAction[] {
  return extractActionsFromAST(parseCode(code));
}

// ── Basic Extraction ────────────────────────────────────────────────

describe("extractActionsFromAST", () => {
  test("extracts a simple key action", () => {
    const code = `
      function CounterKey() {}
      const counterAction = defineAction({
        uuid: "com.example.counter",
        key: CounterKey,
        info: {
          name: "Counter",
          icon: "imgs/counter",
        },
      });
    `;
    const actions = extractFromCode(code);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.uuid).toBe("com.example.counter");
    expect(actions[0]!.hasKey).toBe(true);
    expect(actions[0]!.hasDial).toBe(false);
    expect(actions[0]!.hasTouchStrip).toBe(false);
    expect(actions[0]!.info).toEqual({
      name: "Counter",
      icon: "imgs/counter",
    });
  });

  test("extracts a dial action with encoder info", () => {
    const code = `
      function VolumeDial() {}
      const volumeAction = defineAction({
        uuid: "com.example.volume",
        dial: VolumeDial,
        info: {
          name: "Volume",
          icon: "imgs/volume",
          tooltip: "Adjust volume",
          encoder: {
            layout: "$A0",
            triggerDescription: {
              rotate: "Adjust volume",
              push: "Mute / Unmute",
            },
          },
        },
      });
    `;
    const actions = extractFromCode(code);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.uuid).toBe("com.example.volume");
    expect(actions[0]!.hasKey).toBe(false);
    expect(actions[0]!.hasDial).toBe(true);
    expect(actions[0]!.info!.name).toBe("Volume");
    expect(actions[0]!.info!.encoder).toEqual({
      layout: "$A0",
      triggerDescription: {
        rotate: "Adjust volume",
        push: "Mute / Unmute",
      },
    });
  });

  test("extracts a touchStrip action", () => {
    const code = `
      function EqStrip() {}
      const eqAction = defineAction({
        uuid: "com.example.eq",
        touchStrip: EqStrip,
        info: {
          name: "Equalizer",
          icon: "imgs/eq",
        },
      });
    `;
    const actions = extractFromCode(code);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.hasTouchStrip).toBe(true);
    expect(actions[0]!.hasKey).toBe(false);
    expect(actions[0]!.hasDial).toBe(false);
  });

  test("extracts key + dial action (both controllers)", () => {
    const code = `
      function KeyView() {}
      function DialView() {}
      const bothAction = defineAction({
        uuid: "com.example.both",
        key: KeyView,
        dial: DialView,
        info: {
          name: "Both",
          icon: "imgs/both",
        },
      });
    `;
    const actions = extractFromCode(code);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.hasKey).toBe(true);
    expect(actions[0]!.hasDial).toBe(true);
  });

  test("extracts multiple actions from same module", () => {
    const code = `
      function A() {}
      function B() {}
      const aAction = defineAction({
        uuid: "com.example.a",
        key: A,
        info: { name: "A", icon: "imgs/a" },
      });
      const bAction = defineAction({
        uuid: "com.example.b",
        key: B,
        info: { name: "B", icon: "imgs/b" },
      });
    `;
    const actions = extractFromCode(code);
    expect(actions).toHaveLength(2);
    expect(actions[0]!.uuid).toBe("com.example.a");
    expect(actions[1]!.uuid).toBe("com.example.b");
  });

  test("extracts action with custom states array", () => {
    const code = `
      function Toggle() {}
      const toggleAction = defineAction({
        uuid: "com.example.toggle",
        key: Toggle,
        info: {
          name: "Toggle",
          icon: "imgs/toggle",
          states: [
            { image: "imgs/on", title: "ON" },
            { image: "imgs/off", title: "OFF" },
          ],
        },
      });
    `;
    const actions = extractFromCode(code);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.info!.states).toEqual([
      { image: "imgs/on", title: "ON" },
      { image: "imgs/off", title: "OFF" },
    ]);
  });

  test("extracts action with all optional info fields", () => {
    const code = `
      function Comp() {}
      const fullAction = defineAction({
        uuid: "com.example.full",
        key: Comp,
        info: {
          name: "Full Action",
          icon: "imgs/full",
          tooltip: "A full action",
          disableAutomaticStates: true,
          disableCaching: false,
          supportedInMultiActions: true,
          visibleInActionsList: true,
          userTitleEnabled: false,
          propertyInspectorPath: "pi/index.html",
          supportUrl: "https://example.com/help",
        },
      });
    `;
    const actions = extractFromCode(code);
    expect(actions).toHaveLength(1);
    const info = actions[0]!.info!;
    expect(info.tooltip).toBe("A full action");
    expect(info.disableAutomaticStates).toBe(true);
    expect(info.disableCaching).toBe(false);
    expect(info.supportedInMultiActions).toBe(true);
    expect(info.visibleInActionsList).toBe(true);
    expect(info.userTitleEnabled).toBe(false);
    expect(info.propertyInspectorPath).toBe("pi/index.html");
    expect(info.supportUrl).toBe("https://example.com/help");
  });
});

// ── Disabled Flag ───────────────────────────────────────────────────

describe("disabled flag", () => {
  test("extracts action with disabled: true in info", () => {
    const code = `
      function Exp() {}
      const expAction = defineAction({
        uuid: "com.example.experimental",
        key: Exp,
        info: {
          name: "Experimental",
          icon: "imgs/exp",
          disabled: true,
        },
      });
    `;
    const actions = extractFromCode(code);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.info!.disabled).toBe(true);
  });

  test("extracts action with disabled: false in info", () => {
    const code = `
      function Normal() {}
      const normalAction = defineAction({
        uuid: "com.example.normal",
        key: Normal,
        info: {
          name: "Normal",
          icon: "imgs/normal",
          disabled: false,
        },
      });
    `;
    const actions = extractFromCode(code);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.info!.disabled).toBe(false);
  });
});

// ── Edge Cases ──────────────────────────────────────────────────────

describe("edge cases", () => {
  test("skips defineAction without uuid", () => {
    const code = `
      function Comp() {}
      const action = defineAction({
        key: Comp,
        info: { name: "No UUID", icon: "imgs/no-uuid" },
      });
    `;
    const actions = extractFromCode(code);
    expect(actions).toHaveLength(0);
  });

  test("skips defineAction with non-string uuid", () => {
    const code = `
      const UUID = "com.example.dynamic";
      function Comp() {}
      const action = defineAction({
        uuid: UUID,
        key: Comp,
        info: { name: "Dynamic", icon: "imgs/dynamic" },
      });
    `;
    const actions = extractFromCode(code);
    // UUID is a variable reference, not a string literal — skipped
    expect(actions).toHaveLength(0);
  });

  test("extracts action without info (info is null)", () => {
    const code = `
      function Comp() {}
      const action = defineAction({
        uuid: "com.example.no-info",
        key: Comp,
      });
    `;
    const actions = extractFromCode(code);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.uuid).toBe("com.example.no-info");
    expect(actions[0]!.info).toBeNull();
  });

  test("sets info to null when info uses variable reference", () => {
    const code = `
      const myInfo = { name: "Shared", icon: "imgs/shared" };
      function Comp() {}
      const action = defineAction({
        uuid: "com.example.ref",
        key: Comp,
        info: myInfo,
      });
    `;
    const actions = extractFromCode(code);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.info).toBeNull();
  });

  test("sets info to null when info uses spread", () => {
    const code = `
      const base = { icon: "imgs/shared" };
      function Comp() {}
      const action = defineAction({
        uuid: "com.example.spread",
        key: Comp,
        info: { name: "Spread", ...base },
      });
    `;
    const actions = extractFromCode(code);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.info).toBeNull();
  });

  test("skips non-defineAction calls", () => {
    const code = `
      function someOtherFunction(config) { return config; }
      const result = someOtherFunction({
        uuid: "com.example.other",
        key: function() {},
        info: { name: "Other", icon: "imgs/other" },
      });
    `;
    const actions = extractFromCode(code);
    expect(actions).toHaveLength(0);
  });

  test("returns empty array for modules without defineAction", () => {
    const code = `
      export const x = 42;
      function helper() { return "hello"; }
    `;
    const actions = extractFromCode(code);
    expect(actions).toHaveLength(0);
  });

  test("handles empty defineAction call gracefully", () => {
    const code = `
      const action = defineAction();
    `;
    const actions = extractFromCode(code);
    expect(actions).toHaveLength(0);
  });

  test("handles defineAction with non-object argument", () => {
    const code = `
      const config = {};
      const action = defineAction(config);
    `;
    const actions = extractFromCode(code);
    expect(actions).toHaveLength(0);
  });

  test("extracts info with template literal (no expressions)", () => {
    const code = String.raw`
      function Comp() {}
      const action = defineAction({
        uuid: "com.example.template",
        key: Comp,
        info: {
          name: "Template",
          icon: ` + "`imgs/template`" + `,
        },
      });
    `;
    const actions = extractFromCode(code);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.info!.icon).toBe("imgs/template");
  });
});

// ── extractedToActionSource ─────────────────────────────────────────

describe("extractedToActionSource", () => {
  test("converts key-only action", () => {
    const extracted: ExtractedAction = {
      uuid: "com.example.key",
      hasKey: true,
      hasDial: false,
      hasTouchStrip: false,
      info: { name: "Key", icon: "imgs/key" },
    };
    const source = extractedToActionSource(extracted);
    expect(source.uuid).toBe("com.example.key");
    expect(source.key).toBe(true);
    expect(source.dial).toBeUndefined();
    expect(source.touchStrip).toBeUndefined();
    expect(source.info).toEqual({ name: "Key", icon: "imgs/key" });
  });

  test("converts dial-only action", () => {
    const extracted: ExtractedAction = {
      uuid: "com.example.dial",
      hasKey: false,
      hasDial: true,
      hasTouchStrip: false,
      info: { name: "Dial", icon: "imgs/dial" },
    };
    const source = extractedToActionSource(extracted);
    expect(source.key).toBeUndefined();
    expect(source.dial).toBe(true);
    expect(source.touchStrip).toBeUndefined();
  });

  test("converts action with null info to undefined", () => {
    const extracted: ExtractedAction = {
      uuid: "com.example.no-info",
      hasKey: true,
      hasDial: false,
      hasTouchStrip: false,
      info: null,
    };
    const source = extractedToActionSource(extracted);
    expect(source.info).toBeUndefined();
  });
});

// ── Realistic Sample Code ───────────────────────────────────────────
//
// Simulates what babel/esbuild output looks like for a real .tsx file
// after TypeScript and JSX have been stripped.

describe("realistic transformed code", () => {
  test("extracts from babel-transformed counter action", () => {
    // Simulates babel output: JSX → createElement, types stripped
    const code = `
      import { createElement, useState } from "react";
      import { defineAction, useKeyDown } from "@fcannizzaro/streamdeck-react";

      function CounterKey() {
        const _useState = useState(0),
          count = _useState[0],
          setCount = _useState[1];
        useKeyDown(function() { setCount(function(c) { return c + 1; }); });
        return createElement("div", null,
          createElement("span", null, count)
        );
      }

      export var counterAction = defineAction({
        uuid: "com.example.react-counter.counter",
        key: CounterKey,
        defaultSettings: { count: 0 },
        info: {
          name: "Counter",
          icon: "imgs/actions/counter",
          tooltip: "A simple counter that increments on each key press.",
        },
      });
    `;
    const actions = extractFromCode(code);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.uuid).toBe("com.example.react-counter.counter");
    expect(actions[0]!.hasKey).toBe(true);
    expect(actions[0]!.info!.name).toBe("Counter");
    expect(actions[0]!.info!.icon).toBe("imgs/actions/counter");
    expect(actions[0]!.info!.tooltip).toBe("A simple counter that increments on each key press.");
  });

  test("extracts from babel-transformed encoder action with full encoder block", () => {
    const code = `
      import { defineAction } from "@fcannizzaro/streamdeck-react";

      function VolumeDial() {}

      export var volumeAction = defineAction({
        uuid: "com.example.react-counter.volume",
        dial: VolumeDial,
        info: {
          name: "Volume",
          icon: "imgs/actions/volume",
          tooltip: "Adjust volume with the dial, press to mute.",
          encoder: {
            layout: "$A0",
            triggerDescription: {
              rotate: "Adjust volume",
              push: "Mute / Unmute",
            },
          },
        },
      });
    `;
    const actions = extractFromCode(code);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.hasDial).toBe(true);
    expect(actions[0]!.hasKey).toBe(false);
    expect(actions[0]!.info!.encoder).toEqual({
      layout: "$A0",
      triggerDescription: {
        rotate: "Adjust volume",
        push: "Mute / Unmute",
      },
    });
  });
});
