import { useContext, useCallback, useEffect } from "react";
import { EventBusContext, StreamDeckContext } from "@/context/providers";
import type { JsonValue } from "@elgato/utils";
import { useCallbackRef } from "./internal/useCallbackRef";

// ── useOpenUrl ──────────────────────────────────────────────────────

export function useOpenUrl(): (url: string) => Promise<void> {
  const { adapter } = useContext(StreamDeckContext);

  return useCallback(
    async (url: string) => {
      await adapter.openUrl(url);
    },
    [adapter],
  );
}

// ── useSwitchProfile ────────────────────────────────────────────────

export function useSwitchProfile(): (profile: string, deviceId?: string) => Promise<void> {
  const { adapter, action } = useContext(StreamDeckContext);

  return useCallback(
    async (profile: string, deviceId?: string) => {
      const devId = deviceId ?? action.device.id;
      await adapter.switchToProfile(devId, profile);
    },
    [adapter, action],
  );
}

// ── useSendToPI ─────────────────────────────────────────────────────
// Send a message to the Property Inspector.

export function useSendToPI(): (payload: JsonValue) => Promise<void> {
  const { adapter } = useContext(StreamDeckContext);

  return useCallback(
    async (payload: JsonValue) => {
      await adapter.sendToPropertyInspector(payload);
    },
    [adapter],
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

  // The adapter action handle always has showOk() — it no-ops
  // internally for non-key surfaces.
  return useCallback(async () => {
    await action.showOk();
  }, [action]);
}

// ── useTitle ────────────────────────────────────────────────────────

export function useTitle(): (title: string) => Promise<void> {
  const { action } = useContext(StreamDeckContext);

  // The adapter action handle always has setTitle() — it no-ops
  // internally for non-key surfaces.
  return useCallback(
    async (title: string) => {
      await action.setTitle(title);
    },
    [action],
  );
}
