// ── Plugin Setup ────────────────────────────────────────────────────
export { createPlugin } from "@/plugin.ts";
export { defineAction } from "@/action.ts";

// ── Hooks — Events ──────────────────────────────────────────────────
export {
  useKeyDown,
  useKeyUp,
  useDialRotate,
  useDialDown,
  useDialUp,
  useTouchTap,
  useDialHint,
} from "@/hooks/events.ts";

// ── Hooks — Settings ────────────────────────────────────────────────
export { useSettings, useGlobalSettings } from "@/hooks/settings.ts";

// ── Hooks — Context ─────────────────────────────────────────────────
export {
  useDevice,
  useAction,
  useCanvas,
  useStreamDeck,
} from "@/hooks/context.ts";

// ── Hooks — Lifecycle ───────────────────────────────────────────────
export { useWillAppear, useWillDisappear } from "@/hooks/lifecycle.ts";

// ── Hooks — Utility ─────────────────────────────────────────────────
export {
  useInterval,
  useTimeout,
  usePrevious,
  useTick,
  useAnimationFrame,
} from "@/hooks/utility.ts";

// ── Hooks — SDK ─────────────────────────────────────────────────────
export {
  useOpenUrl,
  useSwitchProfile,
  useSendToPI,
  usePropertyInspector,
  useShowAlert,
  useShowOk,
  useTitle,
} from "@/hooks/sdk.ts";

// ── Components ──────────────────────────────────────────────────────
export { Box } from "@/components/Box.tsx";
export { Text } from "@/components/Text.tsx";
export { Image } from "@/components/Image.tsx";
export { Icon } from "@/components/Icon.tsx";
export { ProgressBar } from "@/components/ProgressBar.tsx";
export { CircularGauge } from "@/components/CircularGauge.tsx";
export { ErrorBoundary } from "@/components/ErrorBoundary.tsx";

// ── Tailwind Utility ────────────────────────────────────────────────
export { tw } from "@/tw/index.ts";

// ── Types ───────────────────────────────────────────────────────────
export type {
  PluginConfig,
  FontConfig,
  ActionConfig,
  ActionDefinition,
  EncoderLayout,
  WrapperComponent,
  DeviceInfo,
  ActionInfo,
  CanvasInfo,
  TouchStripLayout,
  TouchStripLayoutItem,
  KeyDownPayload,
  KeyUpPayload,
  DialRotatePayload,
  DialPressPayload,
  TouchTapPayload,
  DialHints,
  StreamDeckAccess,
} from "@/types.ts";

// ── Component Props Types ───────────────────────────────────────────
export type { BoxProps } from "@/components/Box.tsx";
export type { TextProps } from "@/components/Text.tsx";
export type { ImageProps } from "@/components/Image.tsx";
export type { IconProps } from "@/components/Icon.tsx";
export type { ProgressBarProps } from "@/components/ProgressBar.tsx";
export type { CircularGaugeProps } from "@/components/CircularGauge.tsx";
export type { ErrorBoundaryProps } from "@/components/ErrorBoundary.tsx";
