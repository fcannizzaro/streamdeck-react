/// <reference lib="dom" />

import { describe, expect, test } from "bun:test";
import React, { act } from "react";
import { EventBus } from "@/context/event-bus";
import { EventBusContext } from "@/context/providers";
import {
  useKeyDown,
  useKeyUp,
  useDialRotate,
  useDialDown,
  useDialUp,
  useTouchTap,
} from "@/hooks/events";
import { createDomRoot, sleep } from "@/test-utils/react";
import type {
  KeyDownPayload,
  KeyUpPayload,
  DialRotatePayload,
  DialPressPayload,
  TouchTapPayload,
} from "@/types";

// ── Helpers ─────────────────────────────────────────────────────────

function createTestBus() {
  return new EventBus();
}

async function renderWithBus(bus: EventBus, element: React.ReactElement) {
  const root = createDomRoot();
  await root.render(<EventBusContext.Provider value={bus}>{element}</EventBusContext.Provider>);
  return {
    bus,
    async unmount() {
      await root.unmount();
    },
  };
}

// ── useKeyDown ──────────────────────────────────────────────────────

describe("useKeyDown", () => {
  test("fires callback on keyDown event", async () => {
    const payloads: KeyDownPayload[] = [];
    const bus = createTestBus();

    function TestComponent() {
      useKeyDown((p) => payloads.push(p));
      return null;
    }

    const { unmount } = await renderWithBus(bus, <TestComponent />);
    const payload: KeyDownPayload = {
      settings: { key: "value" },
      isInMultiAction: false,
      state: 0,
    };

    await act(async () => {
      bus.emit("keyDown", payload);
    });

    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toEqual(payload);
    await unmount();
  });

  test("unsubscribes on unmount", async () => {
    let calls = 0;
    const bus = createTestBus();

    function TestComponent() {
      useKeyDown(() => {
        calls += 1;
      });
      return null;
    }

    const { unmount } = await renderWithBus(bus, <TestComponent />);

    await act(async () => {
      bus.emit("keyDown", { settings: {}, isInMultiAction: false, state: 0 });
    });
    expect(calls).toBe(1);

    await unmount();

    bus.emit("keyDown", { settings: {}, isInMultiAction: false, state: 0 });
    expect(calls).toBe(1);
  });
});

// ── useKeyUp ────────────────────────────────────────────────────────

describe("useKeyUp", () => {
  test("fires callback on keyUp event", async () => {
    const payloads: KeyUpPayload[] = [];
    const bus = createTestBus();

    function TestComponent() {
      useKeyUp((p) => payloads.push(p));
      return null;
    }

    const { unmount } = await renderWithBus(bus, <TestComponent />);
    const payload: KeyUpPayload = { settings: {}, isInMultiAction: true, state: 1 };

    await act(async () => {
      bus.emit("keyUp", payload);
    });

    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toEqual(payload);
    await unmount();
  });
});

// ── useDialRotate ───────────────────────────────────────────────────

describe("useDialRotate", () => {
  test("fires callback on dialRotate event", async () => {
    const payloads: DialRotatePayload[] = [];
    const bus = createTestBus();

    function TestComponent() {
      useDialRotate((p) => payloads.push(p));
      return null;
    }

    const { unmount } = await renderWithBus(bus, <TestComponent />);
    const payload: DialRotatePayload = { ticks: 5, pressed: true, settings: {} };

    await act(async () => {
      bus.emit("dialRotate", payload);
    });

    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toEqual(payload);
    await unmount();
  });
});

// ── useDialDown ─────────────────────────────────────────────────────

describe("useDialDown", () => {
  test("fires callback on dialDown event", async () => {
    const payloads: DialPressPayload[] = [];
    const bus = createTestBus();

    function TestComponent() {
      useDialDown((p) => payloads.push(p));
      return null;
    }

    const { unmount } = await renderWithBus(bus, <TestComponent />);
    const payload: DialPressPayload = { settings: {}, controller: "Encoder" };

    await act(async () => {
      bus.emit("dialDown", payload);
    });

    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toEqual(payload);
    await unmount();
  });
});

// ── useDialUp ───────────────────────────────────────────────────────

describe("useDialUp", () => {
  test("fires callback on dialUp event", async () => {
    const payloads: DialPressPayload[] = [];
    const bus = createTestBus();

    function TestComponent() {
      useDialUp((p) => payloads.push(p));
      return null;
    }

    const { unmount } = await renderWithBus(bus, <TestComponent />);
    const payload: DialPressPayload = { settings: { vol: 80 }, controller: "Encoder" };

    await act(async () => {
      bus.emit("dialUp", payload);
    });

    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toEqual(payload);
    await unmount();
  });
});

// ── useTouchTap ─────────────────────────────────────────────────────

describe("useTouchTap", () => {
  test("fires callback on touchTap event", async () => {
    const payloads: TouchTapPayload[] = [];
    const bus = createTestBus();

    function TestComponent() {
      useTouchTap((p) => payloads.push(p));
      return null;
    }

    const { unmount } = await renderWithBus(bus, <TestComponent />);
    const payload: TouchTapPayload = { tapPos: [50, 30], hold: false, settings: {} };

    await act(async () => {
      bus.emit("touchTap", payload);
    });

    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toEqual(payload);
    await unmount();
  });

  test("multiple events are all received", async () => {
    const payloads: TouchTapPayload[] = [];
    const bus = createTestBus();

    function TestComponent() {
      useTouchTap((p) => payloads.push(p));
      return null;
    }

    const { unmount } = await renderWithBus(bus, <TestComponent />);

    await act(async () => {
      bus.emit("touchTap", { tapPos: [10, 10], hold: false, settings: {} });
      bus.emit("touchTap", { tapPos: [20, 20], hold: true, settings: {} });
    });

    expect(payloads).toHaveLength(2);
    expect(payloads[0]!.tapPos).toEqual([10, 10]);
    expect(payloads[1]!.hold).toBe(true);
    await unmount();
  });
});

// ── Callback ref stability ──────────────────────────────────────────

describe("event hooks callback stability", () => {
  test("always uses the latest callback without re-subscribing", async () => {
    const values: number[] = [];
    const bus = createTestBus();
    let counter = 0;

    function TestComponent() {
      counter++;
      const currentCounter = counter;
      useKeyDown(() => {
        values.push(currentCounter);
      });
      return null;
    }

    const root = createDomRoot();
    await root.render(
      <EventBusContext.Provider value={bus}>
        <TestComponent />
      </EventBusContext.Provider>,
    );

    // First render
    await act(async () => {
      bus.emit("keyDown", { settings: {}, isInMultiAction: false, state: 0 });
    });

    // Force re-render
    await root.render(
      <EventBusContext.Provider value={bus}>
        <TestComponent />
      </EventBusContext.Provider>,
    );

    await act(async () => {
      bus.emit("keyDown", { settings: {}, isInMultiAction: false, state: 0 });
    });

    // The second emission should use the updated callback from the re-render
    expect(values).toEqual([1, 2]);

    await root.unmount();
  });
});
