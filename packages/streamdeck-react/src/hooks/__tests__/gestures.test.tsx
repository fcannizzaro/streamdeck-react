/// <reference lib="dom" />

import { describe, expect, test } from "bun:test";
import React, { act, useState } from "react";
import { EventBus } from "@/context/event-bus";
import { EventBusContext } from "@/context/providers";
import { useTap, useLongPress, useDoubleTap } from "@/hooks/gestures";
import { createDomRoot, sleep } from "@/test-utils/react";
import type { KeyDownPayload, KeyUpPayload } from "@/types";

// ── Helpers ─────────────────────────────────────────────────────────

const KEY_DOWN_PAYLOAD: KeyDownPayload = {
  settings: {},
  isInMultiAction: false,
  state: 0,
};

const KEY_UP_PAYLOAD: KeyUpPayload = {
  settings: {},
  isInMultiAction: false,
  state: 0,
};

function createTestBus() {
  return new EventBus();
}

type RenderResult = {
  bus: EventBus;
  unmount: () => Promise<void>;
};

async function renderWithBus(
  bus: EventBus,
  element: React.ReactElement,
): Promise<RenderResult> {
  const root = createDomRoot();
  await root.render(
    <EventBusContext.Provider value={bus}>{element}</EventBusContext.Provider>,
  );

  return {
    bus,
    async unmount() {
      await root.unmount();
    },
  };
}

// ── useTap ──────────────────────────────────────────────────────────

describe("useTap", () => {
  test("fires immediately on keyUp when useDoubleTap is NOT present", async () => {
    let calls = 0;
    const bus = createTestBus();

    function TestComponent() {
      useTap(() => {
        calls += 1;
      });
      return null;
    }

    const { unmount } = await renderWithBus(bus, <TestComponent />);

    await act(async () => {
      bus.emit("keyUp", KEY_UP_PAYLOAD);
    });

    expect(calls).toBe(1);
    await unmount();
  });

  test("fires delayed when useDoubleTap IS present (after timeout)", async () => {
    let tapCalls = 0;
    let doubleTapCalls = 0;
    const bus = createTestBus();

    function TestComponent() {
      useTap(() => {
        tapCalls += 1;
      });
      useDoubleTap(
        () => {
          doubleTapCalls += 1;
        },
        { timeout: 50 },
      );
      return null;
    }

    const { unmount } = await renderWithBus(bus, <TestComponent />);

    await act(async () => {
      bus.emit("keyUp", KEY_UP_PAYLOAD);
    });

    // Should NOT have fired yet — gated by double-tap timeout
    expect(tapCalls).toBe(0);

    await act(async () => {
      await sleep(70);
    });

    // Now it should have fired
    expect(tapCalls).toBe(1);
    expect(doubleTapCalls).toBe(0);
    await unmount();
  });

  test("is cancelled when double-tap is detected", async () => {
    let tapCalls = 0;
    let doubleTapCalls = 0;
    const bus = createTestBus();

    function TestComponent() {
      useTap(() => {
        tapCalls += 1;
      });
      useDoubleTap(
        () => {
          doubleTapCalls += 1;
        },
        { timeout: 100 },
      );
      return null;
    }

    const { unmount } = await renderWithBus(bus, <TestComponent />);

    // First tap
    await act(async () => {
      bus.emit("keyUp", KEY_UP_PAYLOAD);
    });

    await act(async () => {
      await sleep(30);
    });

    // Second tap — double-tap detected
    await act(async () => {
      bus.emit("keyUp", KEY_UP_PAYLOAD);
    });

    // Wait past the timeout
    await act(async () => {
      await sleep(120);
    });

    expect(doubleTapCalls).toBe(1);
    expect(tapCalls).toBe(0);
    await unmount();
  });

  test("passes keyUp payload to callback", async () => {
    const payloads: KeyUpPayload[] = [];
    const bus = createTestBus();
    const payload: KeyUpPayload = {
      settings: { key: "value" },
      isInMultiAction: true,
    };

    function TestComponent() {
      useTap((p) => {
        payloads.push(p);
      });
      return null;
    }

    const { unmount } = await renderWithBus(bus, <TestComponent />);

    await act(async () => {
      bus.emit("keyUp", payload);
    });

    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toEqual(payload);
    await unmount();
  });

  test("passes keyUp payload when gated", async () => {
    const payloads: KeyUpPayload[] = [];
    const bus = createTestBus();
    const payload: KeyUpPayload = {
      settings: { key: "gated" },
      isInMultiAction: false,
    };

    function TestComponent() {
      useTap((p) => {
        payloads.push(p);
      });
      useDoubleTap(() => {}, { timeout: 30 });
      return null;
    }

    const { unmount } = await renderWithBus(bus, <TestComponent />);

    await act(async () => {
      bus.emit("keyUp", payload);
    });

    await act(async () => {
      await sleep(50);
    });

    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toEqual(payload);
    await unmount();
  });
});

// ── useLongPress ────────────────────────────────────────────────────

describe("useLongPress", () => {
  test("fires callback after holding key for >= timeout duration", async () => {
    let calls = 0;
    const bus = createTestBus();

    function TestComponent() {
      useLongPress(
        () => {
          calls += 1;
        },
        { timeout: 50 },
      );
      return null;
    }

    const { unmount } = await renderWithBus(bus, <TestComponent />);

    await act(async () => {
      bus.emit("keyDown", KEY_DOWN_PAYLOAD);
    });

    await act(async () => {
      await sleep(70);
    });

    expect(calls).toBe(1);
    await unmount();
  });

  test("does NOT fire if key is released before timeout", async () => {
    let calls = 0;
    const bus = createTestBus();

    function TestComponent() {
      useLongPress(
        () => {
          calls += 1;
        },
        { timeout: 50 },
      );
      return null;
    }

    const { unmount } = await renderWithBus(bus, <TestComponent />);

    await act(async () => {
      bus.emit("keyDown", KEY_DOWN_PAYLOAD);
    });

    await act(async () => {
      await sleep(20);
    });

    await act(async () => {
      bus.emit("keyUp", KEY_UP_PAYLOAD);
    });

    await act(async () => {
      await sleep(50);
    });

    expect(calls).toBe(0);
    await unmount();
  });

  test("uses default timeout of 500ms", async () => {
    let calls = 0;
    const bus = createTestBus();

    function TestComponent() {
      useLongPress(() => {
        calls += 1;
      });
      return null;
    }

    const { unmount } = await renderWithBus(bus, <TestComponent />);

    await act(async () => {
      bus.emit("keyDown", KEY_DOWN_PAYLOAD);
    });

    // Release after 100ms — well before default 500ms
    await act(async () => {
      await sleep(100);
    });

    await act(async () => {
      bus.emit("keyUp", KEY_UP_PAYLOAD);
    });

    expect(calls).toBe(0);
    await unmount();
  });

  test("passes the keyDown payload to the callback", async () => {
    const payloads: KeyDownPayload[] = [];
    const bus = createTestBus();
    const customPayload: KeyDownPayload = {
      settings: { key: "value" },
      isInMultiAction: true,
      state: 1,
    };

    function TestComponent() {
      useLongPress(
        (payload) => {
          payloads.push(payload);
        },
        { timeout: 30 },
      );
      return null;
    }

    const { unmount } = await renderWithBus(bus, <TestComponent />);

    await act(async () => {
      bus.emit("keyDown", customPayload);
    });

    await act(async () => {
      await sleep(50);
    });

    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toEqual(customPayload);
    await unmount();
  });

  test("cleans up timer on unmount (no leaked callbacks)", async () => {
    let calls = 0;
    const bus = createTestBus();

    function TestComponent() {
      useLongPress(
        () => {
          calls += 1;
        },
        { timeout: 50 },
      );
      return null;
    }

    const { unmount } = await renderWithBus(bus, <TestComponent />);

    await act(async () => {
      bus.emit("keyDown", KEY_DOWN_PAYLOAD);
    });

    await act(async () => {
      await sleep(20);
    });

    // Unmount while timer is still running
    await unmount();

    await act(async () => {
      await sleep(50);
    });

    expect(calls).toBe(0);
  });

  test("repeated keyDown resets the timer", async () => {
    let calls = 0;
    const bus = createTestBus();

    function TestComponent() {
      useLongPress(
        () => {
          calls += 1;
        },
        { timeout: 50 },
      );
      return null;
    }

    const { unmount } = await renderWithBus(bus, <TestComponent />);

    await act(async () => {
      bus.emit("keyDown", KEY_DOWN_PAYLOAD);
    });

    // Wait 30ms then press again — resets timer
    await act(async () => {
      await sleep(30);
    });

    await act(async () => {
      bus.emit("keyDown", KEY_DOWN_PAYLOAD);
    });

    // 30ms after second press — only 30ms into new 50ms timer
    await act(async () => {
      await sleep(30);
    });

    expect(calls).toBe(0);

    // 25ms more — now 55ms after second press
    await act(async () => {
      await sleep(25);
    });

    expect(calls).toBe(1);
    await unmount();
  });
});

// ── useDoubleTap ────────────────────────────────────────────────────

describe("useDoubleTap", () => {
  test("fires callback on two rapid keyUp events within timeout", async () => {
    let calls = 0;
    const bus = createTestBus();

    function TestComponent() {
      useDoubleTap(
        () => {
          calls += 1;
        },
        { timeout: 100 },
      );
      return null;
    }

    const { unmount } = await renderWithBus(bus, <TestComponent />);

    await act(async () => {
      bus.emit("keyUp", KEY_UP_PAYLOAD);
    });

    await act(async () => {
      await sleep(30);
    });

    await act(async () => {
      bus.emit("keyUp", KEY_UP_PAYLOAD);
    });

    expect(calls).toBe(1);
    await unmount();
  });

  test("does NOT fire on a single keyUp", async () => {
    let calls = 0;
    const bus = createTestBus();

    function TestComponent() {
      useDoubleTap(
        () => {
          calls += 1;
        },
        { timeout: 50 },
      );
      return null;
    }

    const { unmount } = await renderWithBus(bus, <TestComponent />);

    await act(async () => {
      bus.emit("keyUp", KEY_UP_PAYLOAD);
    });

    await act(async () => {
      await sleep(70);
    });

    expect(calls).toBe(0);
    await unmount();
  });

  test("does NOT fire if second keyUp is beyond timeout", async () => {
    let calls = 0;
    const bus = createTestBus();

    function TestComponent() {
      useDoubleTap(
        () => {
          calls += 1;
        },
        { timeout: 50 },
      );
      return null;
    }

    const { unmount } = await renderWithBus(bus, <TestComponent />);

    await act(async () => {
      bus.emit("keyUp", KEY_UP_PAYLOAD);
    });

    await act(async () => {
      await sleep(70);
    });

    await act(async () => {
      bus.emit("keyUp", KEY_UP_PAYLOAD);
    });

    expect(calls).toBe(0);
    await unmount();
  });

  test("respects custom timeout value", async () => {
    let calls = 0;
    const bus = createTestBus();

    function TestComponent() {
      useDoubleTap(
        () => {
          calls += 1;
        },
        { timeout: 30 },
      );
      return null;
    }

    const { unmount } = await renderWithBus(bus, <TestComponent />);

    await act(async () => {
      bus.emit("keyUp", KEY_UP_PAYLOAD);
    });

    // Wait 50ms — beyond the 30ms timeout
    await act(async () => {
      await sleep(50);
    });

    await act(async () => {
      bus.emit("keyUp", KEY_UP_PAYLOAD);
    });

    expect(calls).toBe(0);

    // Now do a fast double-tap within 30ms
    await act(async () => {
      bus.emit("keyUp", KEY_UP_PAYLOAD);
    });

    await act(async () => {
      await sleep(15);
    });

    await act(async () => {
      bus.emit("keyUp", KEY_UP_PAYLOAD);
    });

    expect(calls).toBe(1);
    await unmount();
  });

  test("triple-tap fires only once (second tap), third starts a new pair", async () => {
    let calls = 0;
    const bus = createTestBus();

    function TestComponent() {
      useDoubleTap(
        () => {
          calls += 1;
        },
        { timeout: 100 },
      );
      return null;
    }

    const { unmount } = await renderWithBus(bus, <TestComponent />);

    // First tap
    await act(async () => {
      bus.emit("keyUp", KEY_UP_PAYLOAD);
    });

    await act(async () => {
      await sleep(20);
    });

    // Second tap — triggers double-tap
    await act(async () => {
      bus.emit("keyUp", KEY_UP_PAYLOAD);
    });

    expect(calls).toBe(1);

    await act(async () => {
      await sleep(20);
    });

    // Third tap — should NOT trigger (pair was reset after second)
    await act(async () => {
      bus.emit("keyUp", KEY_UP_PAYLOAD);
    });

    expect(calls).toBe(1);
    await unmount();
  });

  test("passes the second keyUp payload to the callback", async () => {
    const payloads: KeyUpPayload[] = [];
    const bus = createTestBus();
    const firstPayload: KeyUpPayload = {
      settings: { tap: "first" },
      isInMultiAction: false,
    };
    const secondPayload: KeyUpPayload = {
      settings: { tap: "second" },
      isInMultiAction: false,
    };

    function TestComponent() {
      useDoubleTap(
        (payload) => {
          payloads.push(payload);
        },
        { timeout: 100 },
      );
      return null;
    }

    const { unmount } = await renderWithBus(bus, <TestComponent />);

    await act(async () => {
      bus.emit("keyUp", firstPayload);
    });

    await act(async () => {
      await sleep(20);
    });

    await act(async () => {
      bus.emit("keyUp", secondPayload);
    });

    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toEqual(secondPayload);
    await unmount();
  });
});
