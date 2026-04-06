import { describe, expect, test, beforeEach } from "bun:test";
import { ActionCoordinator } from "@/coordinator/index";
import type { ActionPresenceInfo } from "@/coordinator/index";

describe("ActionCoordinator", () => {
  let coordinator: ActionCoordinator;

  beforeEach(() => {
    coordinator = new ActionCoordinator();
  });

  // ── Presence Tracking ───────────────────────────────────────────

  describe("presence tracking", () => {
    const makeAction = (
      id: string,
      uuid: string,
      surface: "key" | "dial" | "touch" = "key",
    ): ActionPresenceInfo => ({
      id,
      uuid,
      surface,
      coordinates: { column: 0, row: 0 },
      deviceId: "device-1",
    });

    test("registerAction adds to presence map", () => {
      coordinator.registerAction(makeAction("a1", "com.example.counter"));
      const snapshot = coordinator.getPresenceSnapshot();
      expect(snapshot.count).toBe(1);
      expect(snapshot.all[0]?.id).toBe("a1");
    });

    test("unregisterAction removes from presence map", () => {
      coordinator.registerAction(makeAction("a1", "com.example.counter"));
      coordinator.unregisterAction("a1");
      const snapshot = coordinator.getPresenceSnapshot();
      expect(snapshot.count).toBe(0);
    });

    test("unregisterAction no-ops for unknown action", () => {
      coordinator.unregisterAction("nonexistent");
      expect(coordinator.getPresenceSnapshot().count).toBe(0);
    });

    test("byUuid filters by action UUID", () => {
      coordinator.registerAction(makeAction("a1", "com.example.counter"));
      coordinator.registerAction(makeAction("a2", "com.example.counter"));
      coordinator.registerAction(makeAction("a3", "com.example.volume"));

      const snapshot = coordinator.getPresenceSnapshot();
      expect(snapshot.byUuid("com.example.counter")).toHaveLength(2);
      expect(snapshot.byUuid("com.example.volume")).toHaveLength(1);
      expect(snapshot.byUuid("com.example.missing")).toHaveLength(0);
    });

    test("subscribePresence notifies on register", () => {
      let callCount = 0;
      coordinator.subscribePresence(() => {
        callCount++;
      });

      coordinator.registerAction(makeAction("a1", "com.example.counter"));
      expect(callCount).toBe(1);
    });

    test("subscribePresence notifies on unregister", () => {
      coordinator.registerAction(makeAction("a1", "com.example.counter"));

      let callCount = 0;
      coordinator.subscribePresence(() => {
        callCount++;
      });

      coordinator.unregisterAction("a1");
      expect(callCount).toBe(1);
    });

    test("unsubscribe stops notifications", () => {
      let callCount = 0;
      const unsub = coordinator.subscribePresence(() => {
        callCount++;
      });

      coordinator.registerAction(makeAction("a1", "com.example.counter"));
      expect(callCount).toBe(1);

      unsub();

      coordinator.registerAction(makeAction("a2", "com.example.counter"));
      expect(callCount).toBe(1); // no change
    });

    test("snapshot is memoized per version", () => {
      coordinator.registerAction(makeAction("a1", "com.example.counter"));
      const snap1 = coordinator.getPresenceSnapshot();
      const snap2 = coordinator.getPresenceSnapshot();
      expect(snap1).toBe(snap2); // same reference
    });

    test("snapshot changes on register", () => {
      coordinator.registerAction(makeAction("a1", "com.example.counter"));
      const snap1 = coordinator.getPresenceSnapshot();

      coordinator.registerAction(makeAction("a2", "com.example.volume"));
      const snap2 = coordinator.getPresenceSnapshot();
      expect(snap1).not.toBe(snap2);
      expect(snap2.count).toBe(2);
    });

    test("tracks surface type and coordinates", () => {
      coordinator.registerAction({
        id: "a1",
        uuid: "com.example.volume",
        surface: "dial",
        coordinates: { column: 2, row: 0 },
        deviceId: "device-2",
      });

      const snapshot = coordinator.getPresenceSnapshot();
      const action = snapshot.all[0]!;
      expect(action.surface).toBe("dial");
      expect(action.coordinates).toEqual({ column: 2, row: 0 });
      expect(action.deviceId).toBe("device-2");
    });
  });

  // ── Channel State Bus ─────────────────────────────────────────

  describe("channel state bus", () => {
    test("setChannelValue stores value", () => {
      coordinator.setChannelValue("playback", "playing");
      expect(coordinator.getChannelValue("playback")).toBe("playing");
    });

    test("getChannelValue returns undefined for unset channel", () => {
      expect(coordinator.getChannelValue("nonexistent")).toBeUndefined();
    });

    test("subscribeChannel notifies on value change", () => {
      let callCount = 0;
      coordinator.subscribeChannel("volume", () => {
        callCount++;
      });

      coordinator.setChannelValue("volume", 50);
      expect(callCount).toBe(1);
    });

    test("subscribeChannel does NOT notify on same value", () => {
      coordinator.setChannelValue("volume", 50);

      let callCount = 0;
      coordinator.subscribeChannel("volume", () => {
        callCount++;
      });

      coordinator.setChannelValue("volume", 50); // same value
      expect(callCount).toBe(0);
    });

    test("subscribeChannel only notifies subscribers of that channel", () => {
      let volumeCalls = 0;
      let playbackCalls = 0;

      coordinator.subscribeChannel("volume", () => {
        volumeCalls++;
      });
      coordinator.subscribeChannel("playback", () => {
        playbackCalls++;
      });

      coordinator.setChannelValue("volume", 75);
      expect(volumeCalls).toBe(1);
      expect(playbackCalls).toBe(0);
    });

    test("unsubscribe stops notifications", () => {
      let callCount = 0;
      const unsub = coordinator.subscribeChannel("status", () => {
        callCount++;
      });

      coordinator.setChannelValue("status", "active");
      expect(callCount).toBe(1);

      unsub();

      coordinator.setChannelValue("status", "idle");
      expect(callCount).toBe(1); // no change
    });

    test("multiple subscribers on same channel", () => {
      let calls1 = 0;
      let calls2 = 0;

      coordinator.subscribeChannel("shared", () => {
        calls1++;
      });
      coordinator.subscribeChannel("shared", () => {
        calls2++;
      });

      coordinator.setChannelValue("shared", "updated");
      expect(calls1).toBe(1);
      expect(calls2).toBe(1);
    });

    test("channel with complex value types", () => {
      const state = { playing: true, track: "Song A" };
      coordinator.setChannelValue("media", state);
      expect(coordinator.getChannelValue("media")).toBe(state);
    });

    test("channel value change detection is referential", () => {
      const obj = { count: 1 };
      coordinator.setChannelValue("data", obj);

      let callCount = 0;
      coordinator.subscribeChannel("data", () => {
        callCount++;
      });

      // Same content, new object reference — should notify
      coordinator.setChannelValue("data", { count: 1 });
      expect(callCount).toBe(1);

      // Same reference — should NOT notify
      const current = coordinator.getChannelValue("data");
      coordinator.setChannelValue("data", current);
      expect(callCount).toBe(1);
    });
  });

  // ── Reset ─────────────────────────────────────────────────────

  describe("reset", () => {
    test("clears all state", () => {
      coordinator.registerAction({
        id: "a1",
        uuid: "com.example.counter",
        surface: "key",
        deviceId: "device-1",
      });
      coordinator.setChannelValue("test", "value");

      coordinator.reset();

      expect(coordinator.getPresenceSnapshot().count).toBe(0);
      expect(coordinator.getChannelValue("test")).toBeUndefined();
    });
  });

  // ── Error Isolation ───────────────────────────────────────────

  describe("error isolation", () => {
    test("listener error does not prevent other listeners", () => {
      let secondCalled = false;

      coordinator.subscribeChannel("test", () => {
        throw new Error("boom");
      });
      coordinator.subscribeChannel("test", () => {
        secondCalled = true;
      });

      // Should not throw
      coordinator.setChannelValue("test", "value");
      expect(secondCalled).toBe(true);
    });

    test("presence listener error does not prevent other listeners", () => {
      let secondCalled = false;

      coordinator.subscribePresence(() => {
        throw new Error("boom");
      });
      coordinator.subscribePresence(() => {
        secondCalled = true;
      });

      coordinator.registerAction({
        id: "a1",
        uuid: "com.example.counter",
        surface: "key",
        deviceId: "device-1",
      });
      expect(secondCalled).toBe(true);
    });
  });
});
