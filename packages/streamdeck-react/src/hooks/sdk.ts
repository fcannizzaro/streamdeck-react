import { useContext, useCallback, useEffect } from "react";
import { EventBusContext, StreamDeckContext } from "@/context/providers.ts";
import type { KeyAction } from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils"
import { useCallbackRef } from "./internal/useCallbackRef.ts";

// ── useOpenUrl ──────────────────────────────────────────────────────

export function useOpenUrl(): (url: string) => Promise<void> {
  const { sdk } = useContext(StreamDeckContext);

  return useCallback(
    async (url: string) => {
      await sdk.system.openUrl(url);
    },
    [sdk],
  );
}

// ── useSwitchProfile ────────────────────────────────────────────────

export function useSwitchProfile(): (
  profile: string,
  deviceId?: string,
) => Promise<void> {
  const { sdk, action } = useContext(StreamDeckContext);

  return useCallback(
    async (profile: string, deviceId?: string) => {
      const devId = deviceId ?? action.device.id;
      await sdk.profiles.switchToProfile(devId, profile);
    },
    [sdk, action],
  );
}

// ── useSendToPI ─────────────────────────────────────────────────────
// Send a message to the Property Inspector.

export function useSendToPI(): (payload: JsonValue) => Promise<void> {
  const { sdk } = useContext(StreamDeckContext);

  return useCallback(
    async (payload: JsonValue) => {
      await sdk.ui.sendToPropertyInspector(payload);
    },
    [sdk],
  );
}

// ── usePropertyInspector ────────────────────────────────────────────
// Receive messages from the Property Inspector via the event bus.

export function usePropertyInspector<T extends JsonValue = JsonValue>(
  callback: (payload: T) => void,
): void {
  const bus = useContext(EventBusContext);
  const callbackRef = useCallbackRef(callback);

  useEffect(() => {
    const handler = (payload: unknown) => {
      callbackRef.current(payload as T);
    };
    bus.on("sendToPlugin", handler as never);
    return () => bus.off("sendToPlugin", handler as never);
  }, [bus, callbackRef]);
}

// ── useShowAlert ────────────────────────────────────────────────────

export function useShowAlert(): () => Promise<void> {
  const { action } = useContext(StreamDeckContext);

  return useCallback(async () => {
    await action.showAlert();
  }, [action]);
}

// ── useShowOk ───────────────────────────────────────────────────────

export function useShowOk(): () => Promise<void> {
  const { action } = useContext(StreamDeckContext);

  return useCallback(async () => {
    if ("showOk" in action) {
      await (action as KeyAction).showOk();
    }
  }, [action]);
}

// ── useTitle ────────────────────────────────────────────────────────

export function useTitle(): (title: string) => Promise<void> {
  const { action } = useContext(StreamDeckContext);

  return useCallback(
    async (title: string) => {
      if ("setTitle" in action) {
        await (action as KeyAction).setTitle(title);
      }
    },
    [action],
  );
}
