/// <reference lib="dom" />

import { describe, expect, test } from "bun:test";
import { act } from "react";
import { useStreamDeck, useCanvas } from "@/hooks/context";
import { useOpenUrl } from "@/hooks/sdk";
import { useSettings, useGlobalSettings } from "@/hooks/settings";
import { useWillAppear } from "@/hooks/lifecycle";
import { useDialRotate } from "@/hooks/events";
import { RootRegistry } from "@/roots/registry";
import { ReactRoot } from "@/roots/root";
import type { RenderConfig } from "@/render/pipeline";
import { sleep } from "@/test-utils/sleep";
import type {
  ActionDefinition,
  EncoderLayout,
  JsonObject,
  StreamDeckAccess,
  WillAppearPayload,
} from "@/types";
import type { StreamDeckAdapter } from "@/adapter/types";

// ── Helpers ─────────────────────────────────────────────────────────

function createFakeAdapter() {
  return {
    pluginUUID: "com.example.test",
    connect: async () => {},
    getGlobalSettings: async () => ({}),
    setGlobalSettings: async () => {},
    onGlobalSettingsChanged: () => {},
    registerAction: () => {},
    openUrl: async (_url: string) => {},
    switchToProfile: async () => {},
    sendToPropertyInspector: async () => {},
  } as unknown as StreamDeckAdapter;
}

function createRegistry(
  fakeAdapter: StreamDeckAdapter,
  onGlobalSettingsChange?: (settings: JsonObject) => Promise<void>,
) {
  return new RootRegistry(
    createRenderConfig(),
    fakeAdapter,
    onGlobalSettingsChange ?? (async () => {}),
  );
}

function createRenderConfig(): RenderConfig {
  return {
    getRenderer: () =>
      ({
        render: async () => Buffer.from("rendered"),
      }) as never,
    imageFormat: "png",
    caching: true,
    devicePixelRatio: 1,
    debug: false,
    imageCacheMaxBytes: 16 * 1024 * 1024,
    touchStripCacheMaxBytes: 8 * 1024 * 1024,
    renderPool: null,
  };
}

function createWillAppearEvent(overrides?: { settings?: JsonObject; actionId?: string }) {
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
  test("provides adapter context and replays willAppear to hooks", async () => {
    const openUrlCalls: string[] = [];
    let openUrlHook: ((url: string) => Promise<void>) | undefined;
    let adapterFromHook: StreamDeckAccess["adapter"] | undefined;
    let willAppearPayload: WillAppearPayload | undefined;

    const fakeAdapter = {
      pluginUUID: "com.example.test",
      connect: async () => {},
      getGlobalSettings: async () => ({}),
      setGlobalSettings: async () => {},
      onGlobalSettingsChanged: () => {},
      registerAction: () => {},
      openUrl: async (url: string) => {
        openUrlCalls.push(url);
      },
      switchToProfile: async () => {},
      sendToPropertyInspector: async () => {},
    } as unknown as StreamDeckAdapter;

    function TestAction() {
      openUrlHook = useOpenUrl();
      adapterFromHook = useStreamDeck().adapter;

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

    const registry = new RootRegistry(createRenderConfig(), fakeAdapter, async () => {});

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

    expect(adapterFromHook).toBe(fakeAdapter);
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
    const fakeAdapter = createFakeAdapter();

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

    const registry = createRegistry(fakeAdapter);

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
    const fakeAdapter = createFakeAdapter();

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

    const registry = createRegistry(fakeAdapter);

    await act(async () => {
      registry.create(createWillAppearEvent({ settings: { count: 0 } }), TestAction, definition);
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
    const fakeAdapter = createFakeAdapter();

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

    const registry = createRegistry(fakeAdapter);

    await act(async () => {
      registry.create(createWillAppearEvent({ settings: { volume: 50 } }), TestAction, definition);
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

  test("external updateSettings with identical values does not rerender settings consumers", async () => {
    const fakeAdapter = createFakeAdapter();
    let renderCount = 0;

    function TestAction() {
      useSettings();
      renderCount++;
      return null;
    }

    const definition: ActionDefinition = {
      uuid: "com.example.settings-stable",
      key: TestAction,
      defaultSettings: {},
    };

    const registry = createRegistry(fakeAdapter);

    await act(async () => {
      registry.create(createWillAppearEvent({ settings: { volume: 50 } }), TestAction, definition);
      await sleep(20);
    });

    const initialRenders = renderCount;

    await act(async () => {
      registry.updateSettings("action-1", { volume: 50 });
      await sleep(20);
    });

    expect(renderCount).toBe(initialRenders);

    act(() => {
      registry.destroyAll();
    });
  });

  test("setSettings persists identical values without rerendering", async () => {
    const fakeAdapter = createFakeAdapter();
    let renderCount = 0;
    let persistCalls = 0;
    let setSettingsHook: ((partial: JsonObject) => void) | undefined;

    function TestAction() {
      const [, setSettings] = useSettings();
      setSettingsHook = setSettings as (partial: JsonObject) => void;
      renderCount++;
      return null;
    }

    const definition: ActionDefinition = {
      uuid: "com.example.settings-persist",
      key: TestAction,
      defaultSettings: {},
    };

    const registry = new RootRegistry(createRenderConfig(), fakeAdapter, async () => {});

    const event = {
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
        setSettings: async (_settings: JsonObject) => {
          persistCalls++;
        },
      },
      payload: {
        settings: { enabled: true },
        isInMultiAction: false,
      },
    } as never;

    await act(async () => {
      registry.create(event, TestAction, definition);
      await sleep(20);
    });

    const initialRenders = renderCount;

    await act(async () => {
      setSettingsHook?.({ enabled: true });
      await sleep(20);
    });

    expect(persistCalls).toBe(1);
    expect(renderCount).toBe(initialRenders);

    act(() => {
      registry.destroyAll();
    });
  });

  test("encoder root calls setFeedbackLayout and dispatches dial events", async () => {
    const feedbackLayoutCalls: EncoderLayout[] = [];
    const feedbackCalls: Record<string, unknown>[] = [];
    let dialRotateReceived = false;
    let willAppearPayload: WillAppearPayload | undefined;

    const fakeAdapter = createFakeAdapter();

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

    const registry = createRegistry(fakeAdapter);

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
    const fakeAdapter = createFakeAdapter();

    function DialTestAction() {
      return null;
    }

    const definition: ActionDefinition = {
      uuid: "com.example.custom-layout",
      dial: DialTestAction,
      dialLayout: "$A1",
      defaultSettings: {},
    };

    const registry = createRegistry(fakeAdapter);

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

  test("key root debounce clears a pending timer before scheduling the next flush", async () => {
    const fakeAdapter = createFakeAdapter();
    const originalClearTimeout = globalThis.clearTimeout;
    let clearCalls = 0;
    let root!: ReactRoot;

    globalThis.clearTimeout = ((timer: ReturnType<typeof setTimeout> | number | undefined) => {
      clearCalls++;
      return originalClearTimeout(timer as ReturnType<typeof setTimeout>);
    }) as typeof clearTimeout;

    try {
      await act(async () => {
        root = new ReactRoot(
          () => null,
          {
            id: "action-1",
            uuid: "com.example.debounce-key",
            controller: "Keypad",
            coordinates: { column: 0, row: 0 },
            isInMultiAction: false,
          },
          {
            id: "device-1",
            type: 0,
            size: { columns: 5, rows: 3 },
            name: "Stream Deck",
          },
          { width: 144, height: 144, type: "key" },
          {},
          {},
          {
            setSettings: async (_settings: JsonObject) => {},
            setImage: async (_dataUri: string) => {},
            setTitle: async () => {},
            showOk: async () => {},
            showAlert: async () => {},
            setFeedback: async () => {},
            setFeedbackLayout: async () => {},
            setTriggerDescription: async () => {},
          } as never,
          fakeAdapter,
          createRenderConfig(),
          async () => {},
          async () => {},
        );
        await sleep(25);
      });

      clearCalls = 0;

      await act(async () => {
        await (root as unknown as { flush(): Promise<void> }).flush();
        await sleep(1);
      });

      expect(
        (root as unknown as { container: { renderTimer: ReturnType<typeof setTimeout> | null } })
          .container.renderTimer,
      ).not.toBeNull();

      await act(async () => {
        await (root as unknown as { flush(): Promise<void> }).flush();
      });

      expect(clearCalls).toBeGreaterThanOrEqual(1);
    } finally {
      globalThis.clearTimeout = originalClearTimeout;
      await act(async () => {
        root.unmount();
      });
    }
  });

  test("encoder root uses object dialLayout when provided", async () => {
    const feedbackLayoutCalls: EncoderLayout[] = [];
    const fakeAdapter = createFakeAdapter();

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

    const registry = createRegistry(fakeAdapter);

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

  test("Galleon 100 SD (type 12) uses 144x144 key size", async () => {
    let canvasFromHook: { width: number; height: number; type: string } | undefined;
    const fakeAdapter = createFakeAdapter();

    function TestAction() {
      canvasFromHook = useCanvas();
      return null;
    }

    const definition: ActionDefinition = {
      uuid: "com.example.galleon-key",
      key: TestAction,
      defaultSettings: {},
    };

    const registry = createRegistry(fakeAdapter);

    const event = {
      action: {
        id: "galleon-action-1",
        device: {
          id: "device-galleon",
          type: 12, // Galleon100SD
          size: { columns: 3, rows: 4 },
          name: "Galleon 100 SD",
        },
        controllerType: "Keypad",
        coordinates: { column: 0, row: 0 },
        setSettings: async (_settings: JsonObject) => {},
      },
      payload: {
        settings: {},
        isInMultiAction: false,
      },
    } as never;

    await act(async () => {
      registry.create(event, TestAction, definition);
      await sleep(20);
    });

    expect(canvasFromHook).toEqual({ width: 144, height: 144, type: "key" });

    act(() => {
      registry.destroyAll();
    });
  });

  test("Stream Deck + XL (type 13) uses 144x144 key size", async () => {
    let canvasFromHook: { width: number; height: number; type: string } | undefined;
    const fakeAdapter = createFakeAdapter();

    function TestAction() {
      canvasFromHook = useCanvas();
      return null;
    }

    const definition: ActionDefinition = {
      uuid: "com.example.plus-xl-key",
      key: TestAction,
      defaultSettings: {},
    };

    const registry = createRegistry(fakeAdapter);

    const event = {
      action: {
        id: "plus-xl-action-1",
        device: {
          id: "device-plus-xl",
          type: 13, // StreamDeckPlusXL
          size: { columns: 9, rows: 4 },
          name: "Stream Deck + XL",
        },
        controllerType: "Keypad",
        coordinates: { column: 0, row: 0 },
        setSettings: async (_settings: JsonObject) => {},
      },
      payload: {
        settings: {},
        isInMultiAction: false,
      },
    } as never;

    await act(async () => {
      registry.create(event, TestAction, definition);
      await sleep(20);
    });

    expect(canvasFromHook).toEqual({ width: 144, height: 144, type: "key" });

    act(() => {
      registry.destroyAll();
    });
  });

  test("Stream Deck + XL encoder uses 200x100 dial size", async () => {
    const feedbackLayoutCalls: EncoderLayout[] = [];
    let canvasFromHook: { width: number; height: number; type: string } | undefined;
    const fakeAdapter = createFakeAdapter();

    function DialTestAction() {
      canvasFromHook = useCanvas();
      return null;
    }

    const definition: ActionDefinition = {
      uuid: "com.example.plus-xl-encoder",
      dial: DialTestAction,
      defaultSettings: {},
    };

    const registry = createRegistry(fakeAdapter);

    const encoderEvent = {
      action: {
        id: "plus-xl-encoder-1",
        device: {
          id: "device-plus-xl",
          type: 13, // StreamDeckPlusXL
          size: { columns: 9, rows: 4 },
          name: "Stream Deck + XL",
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

    expect(canvasFromHook).toEqual({ width: 200, height: 100, type: "dial" });
    expect(feedbackLayoutCalls.length).toBe(1);

    act(() => {
      registry.destroyAll();
    });
  });
});
