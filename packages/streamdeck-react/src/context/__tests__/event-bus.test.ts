import { afterEach, describe, expect, test } from "bun:test";
import { EventBus } from "@/context/event-bus";
import type { WillAppearPayload } from "@/types";

describe("EventBus", () => {
  afterEach(() => {
    EventBus.devtoolsObserver = null;
  });

  test("replays sticky events to late subscribers", () => {
    const bus = new EventBus();
    const payload: WillAppearPayload = {
      settings: { enabled: true },
      controller: "Keypad" as const,
      isInMultiAction: false,
    };
    const received: (typeof payload)[] = [];

    bus.emitSticky("willAppear", payload);
    bus.on("willAppear", (event) => {
      received.push(event);
    });

    expect(received).toEqual([payload]);
  });

  test("does not replay non-sticky events", () => {
    const bus = new EventBus();
    const received: Array<{ enabled: boolean }> = [];

    bus.emit("settingsChanged", { enabled: true });
    bus.on("settingsChanged", (event) => {
      received.push(event as { enabled: boolean });
    });

    expect(received).toEqual([]);
  });

  test("clears sticky events on removeAllListeners", () => {
    const bus = new EventBus();
    const firstPayload: WillAppearPayload = {
      settings: { enabled: true },
      controller: "Keypad" as const,
      isInMultiAction: false,
    };
    const secondPayload: WillAppearPayload = {
      settings: { enabled: false },
      controller: "Keypad" as const,
      isInMultiAction: true,
    };
    const received: Array<typeof firstPayload> = [];

    bus.emitSticky("willAppear", firstPayload);
    bus.removeAllListeners();
    bus.on("willAppear", (event) => {
      received.push(event);
    });

    expect(received).toEqual([]);

    bus.emitSticky("willAppear", secondPayload);

    expect(received).toEqual([secondPayload]);
  });

  test("off() removes a specific listener", () => {
    const bus = new EventBus();
    let calls = 0;

    const handler = () => {
      calls += 1;
    };

    bus.on("keyDown", handler);
    bus.emit("keyDown", { settings: {}, isInMultiAction: false, state: 0 });
    expect(calls).toBe(1);

    bus.off("keyDown", handler);
    bus.emit("keyDown", { settings: {}, isInMultiAction: false, state: 0 });
    expect(calls).toBe(1);
  });

  test("emit delivers to multiple listeners in order", () => {
    const bus = new EventBus();
    const order: string[] = [];

    bus.on("keyUp", () => order.push("a"));
    bus.on("keyUp", () => order.push("b"));
    bus.on("keyUp", () => order.push("c"));

    bus.emit("keyUp", { settings: {}, isInMultiAction: false });

    expect(order).toEqual(["a", "b", "c"]);
  });

  test("sticky event is updated on re-emit", () => {
    const bus = new EventBus();
    const first: WillAppearPayload = {
      settings: { v: 1 },
      controller: "Keypad",
      isInMultiAction: false,
    };
    const second: WillAppearPayload = {
      settings: { v: 2 },
      controller: "Encoder",
      isInMultiAction: true,
    };

    bus.emitSticky("willAppear", first);
    bus.emitSticky("willAppear", second);

    // Late subscriber should get the latest sticky value
    const received: WillAppearPayload[] = [];
    bus.on("willAppear", (event) => received.push(event));
    expect(received).toEqual([second]);
  });

  test("listener error does not break other listeners", () => {
    const bus = new EventBus();
    const received: number[] = [];

    // Silence console.error for this test
    const originalError = console.error;
    console.error = () => {};

    bus.on("keyDown", () => {
      throw new Error("boom");
    });
    bus.on("keyDown", () => {
      received.push(1);
    });

    bus.emit("keyDown", { settings: {}, isInMultiAction: false, state: 0 });

    expect(received).toEqual([1]);

    console.error = originalError;
  });

  test("devtoolsObserver is called on emit", () => {
    const bus = new EventBus();
    const observed: Array<{ bus: EventBus; event: string; payload: unknown }> = [];

    EventBus.devtoolsObserver = (b, event, payload) => {
      observed.push({ bus: b, event, payload });
    };

    const payload = { settings: {}, isInMultiAction: false, state: 0 };
    bus.emit("keyDown", payload);

    expect(observed).toHaveLength(1);
    expect(observed[0]!.bus).toBe(bus);
    expect(observed[0]!.event).toBe("keyDown");
    expect(observed[0]!.payload).toEqual(payload);
  });

  test("devtoolsObserver is called on emitSticky", () => {
    const bus = new EventBus();
    const observed: string[] = [];

    EventBus.devtoolsObserver = (_b, event) => {
      observed.push(event);
    };

    bus.emitSticky("willAppear", {
      settings: {},
      controller: "Keypad",
      isInMultiAction: false,
    });

    expect(observed).toEqual(["willAppear"]);
  });

  test("ownerId and ownerUuid default to null", () => {
    const bus = new EventBus();
    expect(bus.ownerId).toBeNull();
    expect(bus.ownerUuid).toBeNull();
  });

  test("ownerId and ownerUuid can be set", () => {
    const bus = new EventBus();
    bus.ownerId = "action-123";
    bus.ownerUuid = "com.example.test";
    expect(bus.ownerId).toBe("action-123");
    expect(bus.ownerUuid).toBe("com.example.test");
  });

  test("off() on unregistered event is a no-op", () => {
    const bus = new EventBus();
    // Should not throw
    bus.off("keyDown", () => {});
  });

  test("emit to event with no listeners is a no-op", () => {
    const bus = new EventBus();
    // Should not throw
    bus.emit("keyDown", { settings: {}, isInMultiAction: false, state: 0 });
  });
});
