// ── Plugin Setup ────────────────────────────────────────────────────
export { createPlugin } from "@/plugin";
export { defineAction } from "@/action";
export type { RenderProfile } from "@/render/pipeline";
export type { CacheStats } from "@/render/image-cache";
export type { RenderMetrics } from "@/render/metrics";

// ── Adapter ─────────────────────────────────────────────────────────
export { physicalDevice } from "@/adapter/physical-device";
export type {
  StreamDeckAdapter,
  AdapterActionHandle,
  AdapterActionCallbacks,
  AdapterWillAppearEvent,
  AdapterActionDevice,
  AdapterController,
  AdapterCoordinates,
  AdapterSize,
  AdapterTriggerDescription,
} from "@/adapter/types";

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

// ── Hooks — Gestures ────────────────────────────────────────────────
export { useTap, useLongPress, useDoubleTap } from "@/hooks/gestures";

// ── Hooks — Settings ────────────────────────────────────────────────
export { useSettings, useGlobalSettings } from "@/hooks/settings";

// ── Hooks — Context ─────────────────────────────────────────────────
export { useDevice, useAction, useCanvas, useStreamDeck } from "@/hooks/context";

// ── Hooks — Lifecycle ───────────────────────────────────────────────
export { useWillAppear, useWillDisappear } from "@/hooks/lifecycle";

// ── Hooks — Utility ─────────────────────────────────────────────────
export { useInterval, useTimeout, usePrevious, useTick } from "@/hooks/utility";

// ── Hooks — Animation ───────────────────────────────────────────────
export { useSpring, useTween, SpringPresets, Easings } from "@/hooks/animation";
export type {
  SpringConfig,
  SpringResult,
  TweenConfig,
  TweenResult,
  EasingName,
  EasingFn,
  AnimationTarget,
  AnimatedValue,
} from "@/hooks/animation";

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
  useTouchStrip,
  useTouchStripTap,
  useTouchStripDialRotate,
  useTouchStripDialDown,
  useTouchStripDialUp,
} from "@/hooks/touchstrip";

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

// ── Google Font Helper ─────────────────────────────────────────────
export { googleFont } from "@/google-font";
export type { GoogleFontVariant } from "@/google-font";

// ── Types ───────────────────────────────────────────────────────────
export type {
  PluginConfig,
  Plugin,
  FontConfig,
  ActionConfig,
  ActionDefinition,
  EncoderLayout,
  WrapperComponent,
  TakumiBackend,
  Controller,
  Coordinates,
  Size,
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
  TouchStripInfo,
  TouchStripTapPayload,
  TouchStripDialRotatePayload,
  TouchStripDialPressPayload,
} from "@/types";

// ── Manifest Types ──────────────────────────────────────────────────
export type {
  PluginManifestInfo,
  ActionManifestInfo,
  ManifestController,
  ManifestEncoderInfo,
  ManifestTriggerDescription,
  ManifestStateInfo,
  ManifestOSInfo,
  ManifestNodejsInfo,
  ManifestProfileInfo,
} from "@/manifest-types";

export type { TapOptions, LongPressOptions, DoubleTapOptions } from "@/hooks/gestures";

// ── Component Props Types ───────────────────────────────────────────
export type { BoxProps } from "@/components/Box";
export type { TextProps } from "@/components/Text";
export type { ImageProps } from "@/components/Image";
export type { IconProps } from "@/components/Icon";
export type { ProgressBarProps } from "@/components/ProgressBar";
export type { CircularGaugeProps } from "@/components/CircularGauge";
export type { ErrorBoundaryProps } from "@/components/ErrorBoundary";
