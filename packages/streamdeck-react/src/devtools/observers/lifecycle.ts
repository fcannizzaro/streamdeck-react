import type { ReactRoot } from "@/roots/root";
import type { TouchBarRoot } from "@/roots/touchbar-root";
import type { CanvasInfo, DeviceInfo } from "@/types";

// ── Registry Observer Interface ─────────────────────────────────────
// Implemented by the DevtoolsBridge. Set on RootRegistry.observer when
// devtools mode is on. All methods are called synchronously from the
// registry's existing code paths.

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

  onTouchBarCreated(
    deviceId: string,
    root: TouchBarRoot,
    deviceInfo: DeviceInfo,
  ): void;

  onTouchBarColumnChanged(
    deviceId: string,
    columns: number[],
    actionMap: Map<number, string>,
  ): void;

  onTouchBarDestroyed(deviceId: string): void;

  onDispatch(actionId: string, event: string, payload: unknown): void;
}
