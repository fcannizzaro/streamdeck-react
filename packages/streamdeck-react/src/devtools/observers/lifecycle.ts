import type { ReactRoot } from "@/roots/root";
import type { TouchStripRoot } from "@/roots/touchstrip-root";
import type { CanvasInfo, DeviceInfo } from "@/types";

// ── Registry Observer Interface ─────────────────────────────────────
//
// Implemented by DevtoolsBridge.  Set on RootRegistry.observer when
// devtools mode is enabled.  All methods are called synchronously
// from the registry's existing code paths (create, destroy, dispatch).
//
// This observer pattern decouples the registry from the devtools
// system — when devtools is off, observer is null and the registry
// pays zero cost (no conditional checks, no serialization).  When
// devtools is on, the bridge receives lifecycle events without the
// registry needing to know anything about the devtools protocol.

export interface RegistryObserver {
  onRootCreated(
    actionId: string,
    root: ReactRoot,
    meta: {
      actionUuid: string;
      surface: "key" | "dial" | "touch";
      canvas: CanvasInfo;
      device: DeviceInfo;
      coordinates?: { column: number; row: number };
    },
  ): void;

  onRootDestroyed(actionId: string): void;

  onTouchStripCreated(deviceId: string, root: TouchStripRoot, deviceInfo: DeviceInfo): void;

  onTouchStripColumnChanged(
    deviceId: string,
    columns: number[],
    actionMap: Map<number, string>,
  ): void;

  onTouchStripDestroyed(deviceId: string): void;

  onDispatch(actionId: string, event: string, payload: unknown): void;
}
