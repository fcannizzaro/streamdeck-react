/// <reference lib="dom" />

import { describe, expect, test } from "bun:test";
import { act } from "react";
import { useGlobalSettings } from "@/hooks/settings";
import { useDevice } from "@/hooks/context";
import {
  useTouchStrip,
  useTouchStripTap,
  useTouchStripDialRotate,
  useTouchStripDialDown,
  useTouchStripDialUp,
} from "@/hooks/touchstrip";
import { RootRegistry } from "@/roots/registry";
import { TouchStripRoot } from "@/roots/touchstrip-root";
import type { RenderConfig } from "@/render/pipeline";
import { sleep } from "@/test-utils/sleep";
import type {
  ActionDefinition,
  DeviceInfo,
  EncoderLayout,
  TouchStripInfo,
  TouchStripTapPayload,
  TouchStripDialRotatePayload,
  TouchStripDialPressPayload,
} from "@/types";
import type { StreamDeckAdapter } from "@/adapter/types";
import type { JsonObject } from "@elgato/utils";

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
    renderer: {
      render: async () => Buffer.from("rendered"),
    } as never,
    imageFormat: "png",
    caching: true,
    devicePixelRatio: 1,
    debug: false,
    imageCacheMaxBytes: 16 * 1024 * 1024,
    touchStripCacheMaxBytes: 8 * 1024 * 1024,
    renderPool: null,
  };
}

function createEncoderEvent(overrides?: {
  actionId?: string;
  column?: number;
  deviceId?: string;
  deviceType?: number;
  settings?: JsonObject;
}) {
  const feedbackLayoutCalls: EncoderLayout[] = [];
  const feedbackCalls: Record<string, unknown>[] = [];

  const ev = {
    action: {
      id: overrides?.actionId ?? "encoder-action-0",
      device: {
        id: overrides?.deviceId ?? "device-plus",
        type: overrides?.deviceType ?? 7, // StreamDeckPlus
        size: { columns: 4, rows: 2 },
        name: "Stream Deck+",
      },
      controllerType: "Encoder",
      coordinates: { column: overrides?.column ?? 0, row: 0 },
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
      settings: overrides?.settings ?? {},
      controller: "Encoder",
      isInMultiAction: false,
    },
  } as never;

  return { ev, feedbackLayoutCalls, feedbackCalls };
}

// ── Tests ───────────────────────────────────────────────────────────

describe("TouchStripRoot integration", () => {
  test("encoder with touchStrip registers with TouchStripRoot instead of per-action root", async () => {
    const fakeSdk = createFakeAdapter();
    const { ev } = createEncoderEvent({ column: 0 });

    let touchStripInfo: TouchStripInfo | undefined;

    function MyTouchStrip() {
      touchStripInfo = useTouchStrip();
      return null;
    }

    const definition: ActionDefinition = {
      uuid: "com.example.touchstrip-test",
      touchStrip: MyTouchStrip,
      defaultSettings: {},
    };

    const registry = createRegistry(fakeSdk);

    await act(async () => {
      registry.create(ev, MyTouchStrip, definition);
      await sleep(20);
    });

    // TouchStrip context should be available
    expect(touchStripInfo).toBeDefined();
    expect(touchStripInfo!.columns).toEqual([0]);
    expect(touchStripInfo!.width).toBe(200);
    expect(touchStripInfo!.height).toBe(100);
    expect(touchStripInfo!.segmentWidth).toBe(200);

    act(() => {
      registry.destroyAll();
    });
  });

  test("multiple encoder columns produce correct TouchStrip width and columns", async () => {
    const fakeSdk = createFakeAdapter();
    let touchStripInfo: TouchStripInfo | undefined;

    function MyTouchStrip() {
      touchStripInfo = useTouchStrip();
      return null;
    }

    const definition: ActionDefinition = {
      uuid: "com.example.multi-column",
      touchStrip: MyTouchStrip,
      defaultSettings: {},
    };

    const registry = createRegistry(fakeSdk);

    const { ev: ev0 } = createEncoderEvent({ actionId: "enc-0", column: 0 });
    const { ev: ev1 } = createEncoderEvent({ actionId: "enc-1", column: 1 });
    const { ev: ev3 } = createEncoderEvent({ actionId: "enc-3", column: 3 });

    await act(async () => {
      registry.create(ev0, MyTouchStrip, definition);
      registry.create(ev1, MyTouchStrip, definition);
      registry.create(ev3, MyTouchStrip, definition);
      await sleep(20);
    });

    // width = (maxColumn + 1) * 200 = 4 * 200 = 800
    expect(touchStripInfo).toBeDefined();
    expect(touchStripInfo!.columns).toEqual([0, 1, 3]);
    expect(touchStripInfo!.width).toBe(800);

    act(() => {
      registry.destroyAll();
    });
  });

  test("touchTap event is translated to absolute coordinates", async () => {
    const fakeSdk = createFakeAdapter();
    const tapPayloads: TouchStripTapPayload[] = [];

    function MyTouchStrip() {
      useTouchStripTap((payload) => {
        tapPayloads.push(payload);
      });
      return null;
    }

    const definition: ActionDefinition = {
      uuid: "com.example.touch-translate",
      touchStrip: MyTouchStrip,
      defaultSettings: {},
    };

    const registry = createRegistry(fakeSdk);

    const { ev: ev0 } = createEncoderEvent({ actionId: "enc-0", column: 0 });
    const { ev: ev2 } = createEncoderEvent({ actionId: "enc-2", column: 2 });

    await act(async () => {
      registry.create(ev0, MyTouchStrip, definition);
      registry.create(ev2, MyTouchStrip, definition);
      await sleep(20);
    });

    // Dispatch a touchTap on column 2 with local tapPos [50, 30]
    await act(async () => {
      registry.dispatch("enc-2", "touchTap", {
        tapPos: [50, 30],
        hold: false,
        settings: {},
      });
      await sleep(20);
    });

    expect(tapPayloads.length).toBe(1);
    // Absolute: column 2 * 200 + 50 = 450
    expect(tapPayloads[0]!.tapPos).toEqual([450, 30]);
    expect(tapPayloads[0]!.hold).toBe(false);
    expect(tapPayloads[0]!.column).toBe(2);

    act(() => {
      registry.destroyAll();
    });
  });

  test("dialRotate event is forwarded with column info", async () => {
    const fakeSdk = createFakeAdapter();
    const rotatePayloads: TouchStripDialRotatePayload[] = [];

    function MyTouchStrip() {
      useTouchStripDialRotate((payload) => {
        rotatePayloads.push(payload);
      });
      return null;
    }

    const definition: ActionDefinition = {
      uuid: "com.example.dial-forward",
      touchStrip: MyTouchStrip,
      defaultSettings: {},
    };

    const registry = createRegistry(fakeSdk);

    const { ev } = createEncoderEvent({ actionId: "enc-1", column: 1 });

    await act(async () => {
      registry.create(ev, MyTouchStrip, definition);
      await sleep(20);
    });

    await act(async () => {
      registry.dispatch("enc-1", "dialRotate", {
        ticks: 3,
        pressed: false,
        settings: {},
      });
      await sleep(20);
    });

    expect(rotatePayloads.length).toBe(1);
    expect(rotatePayloads[0]!.column).toBe(1);
    expect(rotatePayloads[0]!.ticks).toBe(3);
    expect(rotatePayloads[0]!.pressed).toBe(false);

    act(() => {
      registry.destroyAll();
    });
  });

  test("dialDown and dialUp events are forwarded with column info", async () => {
    const fakeSdk = createFakeAdapter();
    const downPayloads: TouchStripDialPressPayload[] = [];
    const upPayloads: TouchStripDialPressPayload[] = [];

    function MyTouchStrip() {
      useTouchStripDialDown((payload) => {
        downPayloads.push(payload);
      });
      useTouchStripDialUp((payload) => {
        upPayloads.push(payload);
      });
      return null;
    }

    const definition: ActionDefinition = {
      uuid: "com.example.dial-press",
      touchStrip: MyTouchStrip,
      defaultSettings: {},
    };

    const registry = createRegistry(fakeSdk);
    const { ev } = createEncoderEvent({ actionId: "enc-2", column: 2 });

    await act(async () => {
      registry.create(ev, MyTouchStrip, definition);
      await sleep(20);
    });

    await act(async () => {
      registry.dispatch("enc-2", "dialDown", {
        settings: {},
        controller: "Encoder",
      });
      registry.dispatch("enc-2", "dialUp", {
        settings: {},
        controller: "Encoder",
      });
      await sleep(20);
    });

    expect(downPayloads.length).toBe(1);
    expect(downPayloads[0]!.column).toBe(2);
    expect(upPayloads.length).toBe(1);
    expect(upPayloads[0]!.column).toBe(2);

    act(() => {
      registry.destroyAll();
    });
  });

  test("removing last column cleans up TouchStripRoot", async () => {
    const fakeSdk = createFakeAdapter();
    let touchStripInfo: TouchStripInfo | undefined;

    function MyTouchStrip() {
      touchStripInfo = useTouchStrip();
      return null;
    }

    const definition: ActionDefinition = {
      uuid: "com.example.cleanup",
      touchStrip: MyTouchStrip,
      defaultSettings: {},
    };

    const registry = createRegistry(fakeSdk);

    const { ev: ev0 } = createEncoderEvent({ actionId: "enc-0", column: 0 });
    const { ev: ev1 } = createEncoderEvent({ actionId: "enc-1", column: 1 });

    await act(async () => {
      registry.create(ev0, MyTouchStrip, definition);
      registry.create(ev1, MyTouchStrip, definition);
      await sleep(20);
    });

    expect(touchStripInfo!.columns).toEqual([0, 1]);

    // Remove column 0 — TouchStrip still alive with column 1
    await act(async () => {
      registry.destroy("enc-0");
      await sleep(20);
    });

    expect(touchStripInfo!.columns).toEqual([1]);
    expect(touchStripInfo!.width).toBe(400); // (1 + 1) * 200

    // Remove column 1 — TouchStrip should be cleaned up
    act(() => {
      registry.destroy("enc-1");
    });

    // After destroying all columns, dispatching should be a no-op (no crash)
    registry.dispatch("enc-0", "touchTap", {
      tapPos: [10, 10],
      hold: false,
      settings: {},
    });
  });

  test("DeviceContext is available in TouchStrip component", async () => {
    const fakeSdk = createFakeAdapter();
    let deviceFromHook: DeviceInfo | undefined;

    function MyTouchStrip() {
      deviceFromHook = useDevice();
      return null;
    }

    const definition: ActionDefinition = {
      uuid: "com.example.device-ctx",
      touchStrip: MyTouchStrip,
      defaultSettings: {},
    };

    const registry = createRegistry(fakeSdk);
    const { ev } = createEncoderEvent({
      actionId: "enc-0",
      column: 0,
      deviceId: "dev-123",
      deviceType: 7,
    });

    await act(async () => {
      registry.create(ev, MyTouchStrip, definition);
      await sleep(20);
    });

    expect(deviceFromHook).toBeDefined();
    expect(deviceFromHook!.id).toBe("dev-123");
    expect(deviceFromHook!.type).toBe(7);

    act(() => {
      registry.destroyAll();
    });
  });

  test("global settings are propagated to TouchStrip root", async () => {
    const fakeSdk = createFakeAdapter();
    let globalSettingsFromHook: JsonObject | undefined;

    function MyTouchStrip() {
      const [gs] = useGlobalSettings();
      globalSettingsFromHook = gs;
      return null;
    }

    const definition: ActionDefinition = {
      uuid: "com.example.global-settings",
      touchStrip: MyTouchStrip,
      defaultSettings: {},
    };

    const registry = createRegistry(fakeSdk);
    const { ev } = createEncoderEvent({ actionId: "enc-0", column: 0 });

    await act(async () => {
      registry.create(ev, MyTouchStrip, definition);
      await sleep(20);
    });

    // Initially empty
    expect(globalSettingsFromHook).toEqual({});

    // Update global settings
    await act(async () => {
      registry.setGlobalSettings({ theme: "dark" });
      await sleep(20);
    });

    expect(globalSettingsFromHook).toEqual({ theme: "dark" });

    act(() => {
      registry.destroyAll();
    });
  });

  test("identical global settings do not rerender TouchStrip consumers", async () => {
    const fakeSdk = createFakeAdapter();
    let renderCount = 0;

    function MyTouchStrip() {
      useGlobalSettings();
      renderCount++;
      return null;
    }

    const definition: ActionDefinition = {
      uuid: "com.example.touchstrip-global-stable",
      touchStrip: MyTouchStrip,
      defaultSettings: {},
    };

    const registry = createRegistry(fakeSdk);
    const { ev } = createEncoderEvent({ actionId: "enc-0", column: 0 });

    await act(async () => {
      registry.create(ev, MyTouchStrip, definition);
      await sleep(20);
    });

    await act(async () => {
      registry.setGlobalSettings({ theme: "dark" });
      await sleep(20);
    });

    const afterFirstUpdate = renderCount;

    await act(async () => {
      registry.setGlobalSettings({ theme: "dark" });
      await sleep(20);
    });

    expect(renderCount).toBe(afterFirstUpdate);

    act(() => {
      registry.destroyAll();
    });
  });

  test("duplicate create for same action ID is a no-op", async () => {
    const fakeSdk = createFakeAdapter();

    function MyTouchStrip() {
      return null;
    }

    const definition: ActionDefinition = {
      uuid: "com.example.duplicate",
      touchStrip: MyTouchStrip,
      defaultSettings: {},
    };

    const registry = createRegistry(fakeSdk);
    const { ev, feedbackLayoutCalls } = createEncoderEvent({ actionId: "enc-0", column: 0 });

    await act(async () => {
      registry.create(ev, MyTouchStrip, definition);
      await sleep(20);
    });

    // Second create for the same action ID should be ignored
    await act(async () => {
      registry.create(ev, MyTouchStrip, definition);
      await sleep(20);
    });

    // No setFeedbackLayout calls — layout is provided by the manifest
    expect(feedbackLayoutCalls.length).toBe(0);

    act(() => {
      registry.destroyAll();
    });
  });

  test("width adapts when columns are added and removed", async () => {
    const fakeSdk = createFakeAdapter();
    let touchStripInfo: TouchStripInfo | undefined;

    function MyTouchStrip() {
      touchStripInfo = useTouchStrip();
      return null;
    }

    const definition: ActionDefinition = {
      uuid: "com.example.adapt",
      touchStrip: MyTouchStrip,
      defaultSettings: {},
    };

    const registry = createRegistry(fakeSdk);

    // Start with columns 0 and 1
    const { ev: ev0 } = createEncoderEvent({ actionId: "enc-0", column: 0 });
    const { ev: ev1 } = createEncoderEvent({ actionId: "enc-1", column: 1 });

    await act(async () => {
      registry.create(ev0, MyTouchStrip, definition);
      registry.create(ev1, MyTouchStrip, definition);
      await sleep(20);
    });

    expect(touchStripInfo!.width).toBe(400); // 2 * 200

    // Add column 3 (gap at 2)
    const { ev: ev3 } = createEncoderEvent({ actionId: "enc-3", column: 3 });

    await act(async () => {
      registry.create(ev3, MyTouchStrip, definition);
      await sleep(20);
    });

    expect(touchStripInfo!.width).toBe(800); // 4 * 200
    expect(touchStripInfo!.columns).toEqual([0, 1, 3]);

    // Remove column 3 — width should shrink
    await act(async () => {
      registry.destroy("enc-3");
      await sleep(20);
    });

    expect(touchStripInfo!.width).toBe(400);
    expect(touchStripInfo!.columns).toEqual([0, 1]);

    act(() => {
      registry.destroyAll();
    });
  });

  test("TouchStrip flush leaves pending timers intact across rapid rerenders", async () => {
    const fakeSdk = createFakeAdapter();
    const originalClearTimeout = globalThis.clearTimeout;
    let clearCalls = 0;
    let root!: TouchStripRoot;

    globalThis.clearTimeout = ((timer: ReturnType<typeof setTimeout> | number | undefined) => {
      clearCalls++;
      return originalClearTimeout(timer as ReturnType<typeof setTimeout>);
    }) as typeof clearTimeout;

    try {
      await act(async () => {
        root = new TouchStripRoot(
          () => null,
          {
            id: "device-plus",
            type: 7,
            size: { columns: 4, rows: 2 },
            name: "Stream Deck+",
          },
          {},
          createRenderConfig(),
          async () => {},
        );

        root.addColumn(0, "enc-0", {
          setFeedback: async (_payload: Record<string, unknown>) => {},
        } as never);

        await sleep(25);
      });

      clearCalls = 0;

      await act(async () => {
        await (root as unknown as { flush(): Promise<void> }).flush();
        await sleep(1);
        await (root as unknown as { flush(): Promise<void> }).flush();
      });

      expect(clearCalls).toBe(0);
    } finally {
      globalThis.clearTimeout = originalClearTimeout;
      await act(async () => {
        root.unmount();
      });
    }
  });
});
