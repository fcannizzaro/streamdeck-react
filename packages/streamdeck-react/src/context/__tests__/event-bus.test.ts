import { describe, expect, test } from "bun:test";
import { EventBus } from "@/context/event-bus.ts";
import type { WillAppearPayload } from "@/types.ts";

describe("EventBus", () => {
  test("replays sticky events to late subscribers", () => {
    const bus = new EventBus();
    const payload: WillAppearPayload = {
      settings: { enabled: true },
      controller: "Keypad" as const,
      isInMultiAction: false,
    };
    const received: typeof payload[] = [];

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
});
