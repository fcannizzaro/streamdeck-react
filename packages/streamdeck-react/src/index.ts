// ── Plugin Setup ────────────────────────────────────────────────────
export { createPlugin } from "@/plugin";
export { defineAction } from "@/action";

// ── Hooks — Events ──────────────────────────────────────────────────
export {
  useKeyDown,
  useKeyUp,
  useDialRotate,
  useDialDown,
  useDialUp,
  useTouchTap,
  useDialHint,
} from "@/hooks/events";

// ── Hooks — Settings ────────────────────────────────────────────────
export { useSettings, useGlobalSettings } from "@/hooks/settings";

// ── Hooks — Context ─────────────────────────────────────────────────
export {
  useDevice,
  useAction,
  useCanvas,
  useStreamDeck,
} from "@/hooks/context";

// ── Hooks — Lifecycle ───────────────────────────────────────────────
export { useWillAppear, useWillDisappear } from "@/hooks/lifecycle";

// ── Hooks — Utility ─────────────────────────────────────────────────
export {
  useInterval,
  useTimeout,
  usePrevious,
  useTick,
  useAnimationFrame,
} from "@/hooks/utility";

// ── Hooks — SDK ─────────────────────────────────────────────────────
export {
  useOpenUrl,
  useSwitchProfile,
  useSendToPI,
  usePropertyInspector,
  useShowAlert,
  useShowOk,
  useTitle,
} from "@/hooks/sdk";

// ── Hooks — Touch Bar ───────────────────────────────────────────────
export {
  useTouchBar,
  useTouchBarTap,
  useTouchBarDialRotate,
  useTouchBarDialDown,
  useTouchBarDialUp,
} from "@/hooks/touchbar";

// ── Components ──────────────────────────────────────────────────────
export { Box } from "@/components/Box";
export { Text } from "@/components/Text";
export { Image } from "@/components/Image";
export { Icon } from "@/components/Icon";
export { ProgressBar } from "@/components/ProgressBar";
export { CircularGauge } from "@/components/CircularGauge";
export { ErrorBoundary } from "@/components/ErrorBoundary";

// ── Tailwind Utility ────────────────────────────────────────────────
export { tw } from "@/tw/index";

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
  TouchBarInfo,
  TouchBarTapPayload,
  TouchBarDialRotatePayload,
  TouchBarDialPressPayload,
} from "@/types";

// ── Component Props Types ───────────────────────────────────────────
export type { BoxProps } from "@/components/Box";
export type { TextProps } from "@/components/Text";
export type { ImageProps } from "@/components/Image";
export type { IconProps } from "@/components/Icon";
export type { ProgressBarProps } from "@/components/ProgressBar";
export type { CircularGaugeProps } from "@/components/CircularGauge";
export type { ErrorBoundaryProps } from "@/components/ErrorBoundary";
