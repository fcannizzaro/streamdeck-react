/// <reference lib="dom" />

import { describe, expect, test } from "bun:test";
import { act } from "react";
import { useStreamDeck } from "@/hooks/context.ts";
import { useOpenUrl } from "@/hooks/sdk.ts";
import { useSettings, useGlobalSettings } from "@/hooks/settings.ts";
import { useWillAppear } from "@/hooks/lifecycle.ts";
import { useDialRotate } from "@/hooks/events.ts";
import { RootRegistry } from "@/roots/registry.ts";
import { sleep } from "@/test-utils/sleep.ts";
import type {
  ActionDefinition,
  EncoderLayout,
  JsonObject,
  StreamDeckAccess,
  WillAppearPayload,
} from "@/types.ts";

// ── Helpers ─────────────────────────────────────────────────────────

function createFakeSdk() {
  return {
    system: {
      openUrl: async (_url: string) => {},
    },
    profiles: {
      switchToProfile: async () => {},
    },
    ui: {
      sendToPropertyInspector: async () => {},
    },
  } as unknown as StreamDeckAccess["sdk"];
}

function createRegistry(
  fakeSdk: StreamDeckAccess["sdk"],
  onGlobalSettingsChange?: (settings: JsonObject) => Promise<void>,
) {
  return new RootRegistry(
    {
      renderer: {} as never,
      imageFormat: "png",
      caching: true,
    },
    0,
    fakeSdk,
    onGlobalSettingsChange ?? (async () => {}),
  );
}

function createWillAppearEvent(overrides?: {
  settings?: JsonObject;
  actionId?: string;
}) {
  return {
    action: {
      id: overrides?.actionId ?? "action-1",
      device: {
        id: "device-1",
        type: 0,
        size: { columns: 5, rows: 3 },
        name: "Stream Deck",
      },
      controllerType: "Keypad",
      coordinates: { column: 0, row: 0 },
      setSettings: async (_settings: JsonObject) => {},
    },
    payload: {
      settings: overrides?.settings ?? { enabled: true },
      isInMultiAction: false,
    },
  } as never;
}

// ── Tests ───────────────────────────────────────────────────────────

describe("ReactRoot integration", () => {
  test("provides sdk context and replays willAppear to hooks", async () => {
    const openUrlCalls: string[] = [];
    let openUrlHook: ((url: string) => Promise<void>) | undefined;
    let sdkFromHook: StreamDeckAccess["sdk"] | undefined;
    let willAppearPayload: WillAppearPayload | undefined;

    const fakeSdk = {
      system: {
        openUrl: async (url: string) => {
          openUrlCalls.push(url);
        },
      },
      profiles: {
        switchToProfile: async () => {},
      },
      ui: {
        sendToPropertyInspector: async () => {},
      },
    } as unknown as StreamDeckAccess["sdk"];

    function TestAction() {
      openUrlHook = useOpenUrl();
      sdkFromHook = useStreamDeck().sdk;

      useWillAppear((payload) => {
        willAppearPayload = payload;
      });

      return null;
    }

    const definition: ActionDefinition = {
      uuid: "com.example.test-action",
      key: TestAction,
      defaultSettings: {},
    };

    const registry = new RootRegistry(
      {
        renderer: {} as never,
        imageFormat: "png",
        caching: true,
      },
      0,
      fakeSdk,
      async () => {},
    );

    await act(async () => {
      registry.create(
        {
          action: {
            id: "action-1",
            device: {
              id: "device-1",
              type: 0,
              size: { columns: 5, rows: 3 },
              name: "Stream Deck",
            },
            controllerType: "Keypad",
            coordinates: { column: 0, row: 0 },
            setSettings: async (_settings: JsonObject) => {},
          },
          payload: {
            settings: { enabled: true },
            isInMultiAction: false,
          },
        } as never,
        TestAction,
        definition,
      );

      await sleep(20);
    });

    expect(sdkFromHook).toBe(fakeSdk);
    expect(willAppearPayload).toEqual({
      settings: { enabled: true },
      controller: "Keypad",
      isInMultiAction: false,
    });

    await openUrlHook?.("https://elgato.com");

    expect(openUrlCalls).toEqual(["https://elgato.com"]);

    act(() => {
      registry.destroyAll();
    });
  });

  test("StreamDeckContext value is referentially stable across settings changes", async () => {
    const sdkRefs: StreamDeckAccess[] = [];
    const fakeSdk = createFakeSdk();

    function TestAction() {
      const sdkValue = useStreamDeck();
      // Capture on every render
      sdkRefs.push(sdkValue);
      return null;
    }

    const definition: ActionDefinition = {
      uuid: "com.example.stable-sdk",
      key: TestAction,
      defaultSettings: {},
    };

    const registry = createRegistry(fakeSdk);

    await act(async () => {
      registry.create(createWillAppearEvent(), TestAction, definition);
      await sleep(20);
    });

    // Initial render captured one ref
    expect(sdkRefs.length).toBeGreaterThanOrEqual(1);
    const initialRef = sdkRefs[0];

    // Trigger a settings change — should re-render but StreamDeck value stays same ref
    await act(async () => {
      registry.updateSettings("action-1", { enabled: false, newKey: "abc" });
      await sleep(20);
    });

    expect(sdkRefs.length).toBeGreaterThanOrEqual(2);

    // Every captured ref should be the exact same object
    for (const ref of sdkRefs) {
      expect(ref).toBe(initialRef!);
    }

    act(() => {
      registry.destroyAll();
    });
  });

  test("settings change does not create new GlobalSettingsContext value", async () => {
    type ContextValue = { settings: JsonObject; setSettings: unknown };
    const globalSettingsRefs: ContextValue[] = [];
    const fakeSdk = createFakeSdk();

    function TestAction() {
      const [globalSettings, setGlobalSettings] = useGlobalSettings();
      // Capture the raw context value to check reference stability
      globalSettingsRefs.push({
        settings: globalSettings,
        setSettings: setGlobalSettings,
      });
      // Also consume settings so the component re-renders on settings change
      useSettings();
      return null;
    }

    const definition: ActionDefinition = {
      uuid: "com.example.isolation",
      key: TestAction,
      defaultSettings: {},
    };

    const registry = createRegistry(fakeSdk);

    await act(async () => {
      registry.create(
        createWillAppearEvent({ settings: { count: 0 } }),
        TestAction,
        definition,
      );
      await sleep(20);
    });

    expect(globalSettingsRefs.length).toBeGreaterThanOrEqual(1);
    const initialGlobalSettings = globalSettingsRefs?.[0]?.settings;

    // Trigger a *settings* change (not global settings)
    await act(async () => {
      registry.updateSettings("action-1", { count: 1 });
      await sleep(20);
    });

    // GlobalSettings value should not have changed
    for (const ref of globalSettingsRefs) {
      expect(ref.settings).toBe(initialGlobalSettings!);
    }

    act(() => {
      registry.destroyAll();
    });
  });

  test("settings are updated correctly after external updateSettings", async () => {
    let currentSettings: JsonObject = {};
    const fakeSdk = createFakeSdk();

    function TestAction() {
      const [settings] = useSettings();
      currentSettings = settings;
      return null;
    }

    const definition: ActionDefinition = {
      uuid: "com.example.settings-update",
      key: TestAction,
      defaultSettings: {},
    };

    const registry = createRegistry(fakeSdk);

    await act(async () => {
      registry.create(
        createWillAppearEvent({ settings: { volume: 50 } }),
        TestAction,
        definition,
      );
      await sleep(20);
    });

    expect(currentSettings).toEqual({ volume: 50 });

    // External settings update
    await act(async () => {
      registry.updateSettings("action-1", { volume: 80 });
      await sleep(20);
    });

    expect(currentSettings).toEqual({ volume: 80 });

    act(() => {
      registry.destroyAll();
    });
  });

  test("encoder root calls setFeedbackLayout and dispatches dial events", async () => {
    const feedbackLayoutCalls: EncoderLayout[] = [];
    const feedbackCalls: Record<string, unknown>[] = [];
    let dialRotateReceived = false;
    let willAppearPayload: WillAppearPayload | undefined;

    const fakeSdk = createFakeSdk();

    function DialTestAction() {
      useWillAppear((payload) => {
        willAppearPayload = payload;
      });

      useDialRotate(() => {
        dialRotateReceived = true;
      });

      return null;
    }

    const definition: ActionDefinition = {
      uuid: "com.example.encoder-test",
      dial: DialTestAction,
      defaultSettings: {},
    };

    const registry = createRegistry(fakeSdk);

    const encoderEvent = {
      action: {
        id: "encoder-action-1",
        device: {
          id: "device-plus",
          type: 7, // StreamDeckPlus
          size: { columns: 4, rows: 2 },
          name: "Stream Deck+",
        },
        controllerType: "Encoder",
        setSettings: async (_settings: JsonObject) => {},
        setFeedbackLayout: async (layout: EncoderLayout) => {
          feedbackLayoutCalls.push(layout);
        },
        setFeedback: async (payload: Record<string, unknown>) => {
          feedbackCalls.push(payload);
        },
        setTriggerDescription: async () => {},
      },
      payload: {
        settings: { volume: 50 },
        controller: "Encoder",
        isInMultiAction: false,
      },
    } as never;

    await act(async () => {
      registry.create(encoderEvent, DialTestAction, definition);
      await sleep(20);
    });

    expect(feedbackLayoutCalls).toEqual([
      {
        id: "com.example.plugin.react-layout",
        items: [
          {
            key: "canvas",
            type: "pixmap",
            rect: [0, 0, 200, 100],
          },
        ],
      },
    ]);

    // willAppear should have fired with Encoder controller
    expect(willAppearPayload).toEqual({
      settings: { volume: 50 },
      controller: "Encoder",
      isInMultiAction: false,
    });

    // Dispatch a dialRotate event and verify the hook fires
    await act(async () => {
      registry.dispatch("encoder-action-1", "dialRotate", {
        ticks: 3,
        pressed: false,
        settings: { volume: 50 },
      });
      await sleep(20);
    });

    expect(dialRotateReceived).toBe(true);

    act(() => {
      registry.destroyAll();
    });
  });

  test("encoder root uses custom dialLayout when provided", async () => {
    const feedbackLayoutCalls: EncoderLayout[] = [];
    const fakeSdk = createFakeSdk();

    function DialTestAction() {
      return null;
    }

    const definition: ActionDefinition = {
      uuid: "com.example.custom-layout",
      dial: DialTestAction,
      dialLayout: "$A1",
      defaultSettings: {},
    };

    const registry = createRegistry(fakeSdk);

    const encoderEvent = {
      action: {
        id: "encoder-action-2",
        device: {
          id: "device-plus",
          type: 7,
          size: { columns: 4, rows: 2 },
          name: "Stream Deck+",
        },
        controllerType: "Encoder",
        setSettings: async (_settings: JsonObject) => {},
        setFeedbackLayout: async (layout: EncoderLayout) => {
          feedbackLayoutCalls.push(layout);
        },
        setFeedback: async () => {},
        setTriggerDescription: async () => {},
      },
      payload: {
        settings: {},
        controller: "Encoder",
        isInMultiAction: false,
      },
    } as never;

    await act(async () => {
      registry.create(encoderEvent, DialTestAction, definition);
      await sleep(20);
    });

    expect(feedbackLayoutCalls).toEqual(["$A1"]);

    act(() => {
      registry.destroyAll();
    });
  });

  test("encoder root uses object dialLayout when provided", async () => {
    const feedbackLayoutCalls: EncoderLayout[] = [];
    const fakeSdk = createFakeSdk();

    function DialTestAction() {
      return null;
    }

    const layout: Exclude<EncoderLayout, string> = {
      id: "com.example.custom-layout",
      items: [
        {
          key: "canvas",
          type: "pixmap",
          rect: [0, 0, 200, 100],
        },
      ],
    };

    const definition: ActionDefinition = {
      uuid: "com.example.object-layout",
      dial: DialTestAction,
      dialLayout: layout,
      defaultSettings: {},
    };

    const registry = createRegistry(fakeSdk);

    const encoderEvent = {
      action: {
        id: "encoder-action-3",
        device: {
          id: "device-plus",
          type: 7,
          size: { columns: 4, rows: 2 },
          name: "Stream Deck+",
        },
        controllerType: "Encoder",
        setSettings: async (_settings: JsonObject) => {},
        setFeedbackLayout: async (nextLayout: EncoderLayout) => {
          feedbackLayoutCalls.push(nextLayout);
        },
        setFeedback: async () => {},
        setTriggerDescription: async () => {},
      },
      payload: {
        settings: {},
        controller: "Encoder",
        isInMultiAction: false,
      },
    } as never;

    await act(async () => {
      registry.create(encoderEvent, DialTestAction, definition);
      await sleep(20);
    });

    expect(feedbackLayoutCalls).toEqual([layout]);

    act(() => {
      registry.destroyAll();
    });
  });
});
