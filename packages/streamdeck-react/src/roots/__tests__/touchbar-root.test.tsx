/// <reference lib="dom" />

import { describe, expect, test } from "bun:test";
import { act } from "react";
import { useGlobalSettings } from "@/hooks/settings";
import { useDevice } from "@/hooks/context";
import {
  useTouchBar,
  useTouchBarTap,
  useTouchBarDialRotate,
  useTouchBarDialDown,
  useTouchBarDialUp,
} from "@/hooks/touchbar";
import { RootRegistry } from "@/roots/registry";
import { sleep } from "@/test-utils/sleep";
import type {
  ActionDefinition,
  DeviceInfo,
  EncoderLayout,
  StreamDeckAccess,
  TouchBarInfo,
  TouchBarTapPayload,
  TouchBarDialRotatePayload,
  TouchBarDialPressPayload,
} from "@/types";
import type { JsonObject } from "@elgato/utils";

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

describe("TouchBarRoot integration", () => {
  test("encoder with touchbar registers with TouchBarRoot instead of per-action root", async () => {
    const fakeSdk = createFakeSdk();
    const { ev } = createEncoderEvent({ column: 0 });

    let touchBarInfo: TouchBarInfo | undefined;

    function MyTouchBar() {
      touchBarInfo = useTouchBar();
      return null;
    }

    const definition: ActionDefinition = {
      uuid: "com.example.touchbar-test",
      touchBar: MyTouchBar,
      defaultSettings: {},
    };

    const registry = createRegistry(fakeSdk);

    await act(async () => {
      registry.create(ev, MyTouchBar, definition);
      await sleep(20);
    });

    // TouchBar context should be available
    expect(touchBarInfo).toBeDefined();
    expect(touchBarInfo!.columns).toEqual([0]);
    expect(touchBarInfo!.width).toBe(200);
    expect(touchBarInfo!.height).toBe(100);
    expect(touchBarInfo!.segmentWidth).toBe(200);

    act(() => {
      registry.destroyAll();
    });
  });

  test("multiple encoder columns produce correct touchbar width and columns", async () => {
    const fakeSdk = createFakeSdk();
    let touchBarInfo: TouchBarInfo | undefined;

    function MyTouchBar() {
      touchBarInfo = useTouchBar();
      return null;
    }

    const definition: ActionDefinition = {
      uuid: "com.example.multi-column",
      touchBar: MyTouchBar,
      defaultSettings: {},
    };

    const registry = createRegistry(fakeSdk);

    const { ev: ev0 } = createEncoderEvent({ actionId: "enc-0", column: 0 });
    const { ev: ev1 } = createEncoderEvent({ actionId: "enc-1", column: 1 });
    const { ev: ev3 } = createEncoderEvent({ actionId: "enc-3", column: 3 });

    await act(async () => {
      registry.create(ev0, MyTouchBar, definition);
      registry.create(ev1, MyTouchBar, definition);
      registry.create(ev3, MyTouchBar, definition);
      await sleep(20);
    });

    // width = (maxColumn + 1) * 200 = 4 * 200 = 800
    expect(touchBarInfo).toBeDefined();
    expect(touchBarInfo!.columns).toEqual([0, 1, 3]);
    expect(touchBarInfo!.width).toBe(800);

    act(() => {
      registry.destroyAll();
    });
  });

  test("touchTap event is translated to absolute coordinates", async () => {
    const fakeSdk = createFakeSdk();
    const tapPayloads: TouchBarTapPayload[] = [];

    function MyTouchBar() {
      useTouchBarTap((payload) => {
        tapPayloads.push(payload);
      });
      return null;
    }

    const definition: ActionDefinition = {
      uuid: "com.example.touch-translate",
      touchBar: MyTouchBar,
      defaultSettings: {},
    };

    const registry = createRegistry(fakeSdk);

    const { ev: ev0 } = createEncoderEvent({ actionId: "enc-0", column: 0 });
    const { ev: ev2 } = createEncoderEvent({ actionId: "enc-2", column: 2 });

    await act(async () => {
      registry.create(ev0, MyTouchBar, definition);
      registry.create(ev2, MyTouchBar, definition);
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
    const fakeSdk = createFakeSdk();
    const rotatePayloads: TouchBarDialRotatePayload[] = [];

    function MyTouchBar() {
      useTouchBarDialRotate((payload) => {
        rotatePayloads.push(payload);
      });
      return null;
    }

    const definition: ActionDefinition = {
      uuid: "com.example.dial-forward",
      touchBar: MyTouchBar,
      defaultSettings: {},
    };

    const registry = createRegistry(fakeSdk);

    const { ev } = createEncoderEvent({ actionId: "enc-1", column: 1 });

    await act(async () => {
      registry.create(ev, MyTouchBar, definition);
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
    const fakeSdk = createFakeSdk();
    const downPayloads: TouchBarDialPressPayload[] = [];
    const upPayloads: TouchBarDialPressPayload[] = [];

    function MyTouchBar() {
      useTouchBarDialDown((payload) => {
        downPayloads.push(payload);
      });
      useTouchBarDialUp((payload) => {
        upPayloads.push(payload);
      });
      return null;
    }

    const definition: ActionDefinition = {
      uuid: "com.example.dial-press",
      touchBar: MyTouchBar,
      defaultSettings: {},
    };

    const registry = createRegistry(fakeSdk);
    const { ev } = createEncoderEvent({ actionId: "enc-2", column: 2 });

    await act(async () => {
      registry.create(ev, MyTouchBar, definition);
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

  test("removing last column cleans up TouchBarRoot", async () => {
    const fakeSdk = createFakeSdk();
    let touchBarInfo: TouchBarInfo | undefined;

    function MyTouchBar() {
      touchBarInfo = useTouchBar();
      return null;
    }

    const definition: ActionDefinition = {
      uuid: "com.example.cleanup",
      touchBar: MyTouchBar,
      defaultSettings: {},
    };

    const registry = createRegistry(fakeSdk);

    const { ev: ev0 } = createEncoderEvent({ actionId: "enc-0", column: 0 });
    const { ev: ev1 } = createEncoderEvent({ actionId: "enc-1", column: 1 });

    await act(async () => {
      registry.create(ev0, MyTouchBar, definition);
      registry.create(ev1, MyTouchBar, definition);
      await sleep(20);
    });

    expect(touchBarInfo!.columns).toEqual([0, 1]);

    // Remove column 0 — touchbar still alive with column 1
    await act(async () => {
      registry.destroy("enc-0");
      await sleep(20);
    });

    expect(touchBarInfo!.columns).toEqual([1]);
    expect(touchBarInfo!.width).toBe(400); // (1 + 1) * 200

    // Remove column 1 — touchbar should be cleaned up
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

  test("DeviceContext is available in touchbar component", async () => {
    const fakeSdk = createFakeSdk();
    let deviceFromHook: DeviceInfo | undefined;

    function MyTouchBar() {
      deviceFromHook = useDevice();
      return null;
    }

    const definition: ActionDefinition = {
      uuid: "com.example.device-ctx",
      touchBar: MyTouchBar,
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
      registry.create(ev, MyTouchBar, definition);
      await sleep(20);
    });

    expect(deviceFromHook).toBeDefined();
    expect(deviceFromHook!.id).toBe("dev-123");
    expect(deviceFromHook!.type).toBe(7);

    act(() => {
      registry.destroyAll();
    });
  });

  test("global settings are propagated to touchbar root", async () => {
    const fakeSdk = createFakeSdk();
    let globalSettingsFromHook: JsonObject | undefined;

    function MyTouchBar() {
      const [gs] = useGlobalSettings();
      globalSettingsFromHook = gs;
      return null;
    }

    const definition: ActionDefinition = {
      uuid: "com.example.global-settings",
      touchBar: MyTouchBar,
      defaultSettings: {},
    };

    const registry = createRegistry(fakeSdk);
    const { ev } = createEncoderEvent({ actionId: "enc-0", column: 0 });

    await act(async () => {
      registry.create(ev, MyTouchBar, definition);
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

  test("duplicate create for same action ID is a no-op", async () => {
    const fakeSdk = createFakeSdk();

    function MyTouchBar() {
      return null;
    }

    const definition: ActionDefinition = {
      uuid: "com.example.duplicate",
      touchBar: MyTouchBar,
      defaultSettings: {},
    };

    const registry = createRegistry(fakeSdk);
    const { ev, feedbackLayoutCalls } = createEncoderEvent({ actionId: "enc-0", column: 0 });

    await act(async () => {
      registry.create(ev, MyTouchBar, definition);
      await sleep(20);
    });

    // Second create for the same action ID should be ignored
    await act(async () => {
      registry.create(ev, MyTouchBar, definition);
      await sleep(20);
    });

    // No setFeedbackLayout calls — layout is provided by the manifest
    expect(feedbackLayoutCalls.length).toBe(0);

    act(() => {
      registry.destroyAll();
    });
  });

  test("width adapts when columns are added and removed", async () => {
    const fakeSdk = createFakeSdk();
    let touchBarInfo: TouchBarInfo | undefined;

    function MyTouchBar() {
      touchBarInfo = useTouchBar();
      return null;
    }

    const definition: ActionDefinition = {
      uuid: "com.example.adapt",
      touchBar: MyTouchBar,
      defaultSettings: {},
    };

    const registry = createRegistry(fakeSdk);

    // Start with columns 0 and 1
    const { ev: ev0 } = createEncoderEvent({ actionId: "enc-0", column: 0 });
    const { ev: ev1 } = createEncoderEvent({ actionId: "enc-1", column: 1 });

    await act(async () => {
      registry.create(ev0, MyTouchBar, definition);
      registry.create(ev1, MyTouchBar, definition);
      await sleep(20);
    });

    expect(touchBarInfo!.width).toBe(400); // 2 * 200

    // Add column 3 (gap at 2)
    const { ev: ev3 } = createEncoderEvent({ actionId: "enc-3", column: 3 });

    await act(async () => {
      registry.create(ev3, MyTouchBar, definition);
      await sleep(20);
    });

    expect(touchBarInfo!.width).toBe(800); // 4 * 200
    expect(touchBarInfo!.columns).toEqual([0, 1, 3]);

    // Remove column 3 — width should shrink
    await act(async () => {
      registry.destroy("enc-3");
      await sleep(20);
    });

    expect(touchBarInfo!.width).toBe(400);
    expect(touchBarInfo!.columns).toEqual([0, 1]);

    act(() => {
      registry.destroyAll();
    });
  });
});
