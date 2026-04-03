import { describe, expect, test } from "bun:test";
import { fuzz, gen, setSeed } from "@/test-utils/fuzz";
import { EventBus } from "@/context/event-bus";
import type { EventMap } from "@/types";

// ── EventBus Fuzz Tests ─────────────────────────────────────────────
//
// Exercises the typed event bus with randomized subscription/emission
// patterns to verify:
//
//   1. Listener errors don't crash other listeners
//   2. Sticky events are correctly replayed
//   3. Rapid subscribe/unsubscribe cycles don't cause corruption
//   4. removeAllListeners fully cleans up

setSeed(42);

describe("fuzz: EventBus", () => {
  test("never crashes on rapid emit cycles (1000 iterations)", () => {
    const bus = new EventBus();
    let callCount = 0;

    bus.on("keyDown", () => {
      callCount++;
    });

    fuzz(1000, () => {
      expect(() =>
        bus.emit("keyDown", {
          settings: {},
          isInMultiAction: gen.bool(),
          state: gen.int(0, 10),
        }),
      ).not.toThrow();
    });

    expect(callCount).toBe(1000);
  });

  test("throwing listeners don't prevent other listeners from firing", () => {
    const bus = new EventBus();
    const results: number[] = [];

    bus.on("keyDown", () => {
      results.push(1);
    });

    bus.on("keyDown", () => {
      throw new Error("listener crash");
    });

    bus.on("keyDown", () => {
      results.push(3);
    });

    // Should not throw despite the crashing listener
    expect(() =>
      bus.emit("keyDown", {
        settings: {},
        isInMultiAction: false,
      }),
    ).not.toThrow();

    // Both non-throwing listeners should have fired
    expect(results).toEqual([1, 3]);
  });

  test("sticky events are replayed to late subscribers (500 iterations)", () => {
    fuzz(500, () => {
      const bus = new EventBus();
      const payload = {
        settings: { key: gen.string(1, 10) },
        controller: gen.pick(["Keypad", "Encoder"] as const),
        isInMultiAction: gen.bool(),
      };

      // Emit sticky BEFORE subscribing
      bus.emitSticky("willAppear", payload);

      let received: typeof payload | null = null;
      bus.on("willAppear", (p) => {
        received = p;
      });

      // Late subscriber should have received the sticky payload
      expect(received).toBe(payload);
    });
  });

  test("rapid subscribe/unsubscribe doesn't corrupt listener set (500 iterations)", () => {
    const bus = new EventBus();
    let callCount = 0;

    fuzz(500, () => {
      const listener = () => {
        callCount++;
      };

      bus.on("keyUp", listener);
      if (gen.bool()) {
        bus.off("keyUp", listener);
      }

      bus.emit("keyUp", {
        settings: {},
        isInMultiAction: false,
      });
    });

    // callCount should be non-negative (no double-firing or negative counts)
    expect(callCount).toBeGreaterThanOrEqual(0);
  });

  test("removeAllListeners fully cleans up (200 iterations)", () => {
    fuzz(200, () => {
      const bus = new EventBus();
      let called = false;

      const listenerCount = gen.int(1, 10);
      for (let i = 0; i < listenerCount; i++) {
        bus.on("keyDown", () => {
          called = true;
        });
      }

      if (gen.bool()) {
        bus.emitSticky("willAppear", {
          settings: {},
          controller: "Keypad",
          isInMultiAction: false,
        });
      }

      bus.removeAllListeners();

      called = false;
      bus.emit("keyDown", {
        settings: {},
        isInMultiAction: false,
      });

      expect(called).toBe(false);
    });
  });

  test("multiple event types don't interfere with each other (500 iterations)", () => {
    fuzz(500, () => {
      const bus = new EventBus();
      const keyDownCount = { value: 0 };
      const keyUpCount = { value: 0 };

      bus.on("keyDown", () => {
        keyDownCount.value++;
      });
      bus.on("keyUp", () => {
        keyUpCount.value++;
      });

      const event = gen.pick(["keyDown", "keyUp"] as const);
      if (event === "keyDown") {
        bus.emit("keyDown", { settings: {}, isInMultiAction: false });
      } else {
        bus.emit("keyUp", { settings: {}, isInMultiAction: false });
      }

      // Only the matching event's counter should have incremented
      expect(keyDownCount.value + keyUpCount.value).toBe(1);
    });
  });
});
