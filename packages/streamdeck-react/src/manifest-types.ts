// ── Manifest Types ──────────────────────────────────────────────────
//
// Type definitions for code-first manifest.json generation.
//
// These types model the Elgato Stream Deck plugin manifest schema
// using camelCase conventions (TypeScript standard).  The generation
// engine (manifest-gen.ts) transforms them to PascalCase for the
// output JSON.
//
// Design principles:
//
//   1. Manual-required fields have no default — the user must provide them.
//   2. Auto-derived fields have sensible defaults documented via @default.
//      The user can override any auto-derived field.
//   3. Types mirror the official Elgato schema but only expose fields
//      that are relevant to streamdeck-react plugins (e.g. CodePath
//      is always a Node.js entry point, not a binary).
//
// Usage:
//
//   Action info is defined on defineAction():
//
//     export const myAction = defineAction({
//       uuid: "com.example.my-plugin.counter",
//       key: CounterKey,
//       info: { name: "Counter", icon: "imgs/counter" },
//     });
//
//   The bundler plugin only needs plugin-level info — actions are
//   auto-extracted from defineAction() calls in the module graph:
//
//     streamDeckReact({
//       manifest: {
//         uuid: "com.example.my-plugin",
//         name: "My Plugin",
//         author: "Me",
//         description: "...",
//         icon: "imgs/plugin-icon",
//         version: "1.0.0.0",
//       },
//     })

// ── Controller ──────────────────────────────────────────────────────

export type ManifestController = "Encoder" | "Keypad";

// ── OS ──────────────────────────────────────────────────────────────

export interface ManifestOSInfo {
  platform: "mac" | "windows";
  minimumVersion: string;
}

// ── Node.js ─────────────────────────────────────────────────────────

export interface ManifestNodejsInfo {
  /**
   * Node.js version to use.
   * @default "24"
   */
  version: "20" | "24";

  /**
   * Debug configuration.  `"enabled"` and `"break"` are shortcuts for
   * `--inspect` and `--inspect-brk` respectively.  A custom string is
   * passed as-is (e.g. `"--inspect=127.0.0.1:8090"`).
   */
  debug?: string;

  /** Enable profiler output. */
  generateProfilerOutput?: boolean;
}

// ── State ───────────────────────────────────────────────────────────

export interface ManifestStateInfo {
  /** Path to state image (extension omitted). 72×72 and 144×144 @2x. */
  image: string;

  /** State name (shown in multi-action state selector). */
  name?: string;

  /** Default title text. */
  title?: string;

  /** Whether to show the title. */
  showTitle?: boolean;

  /** Title alignment. */
  titleAlignment?: "bottom" | "middle" | "top";

  /** Title color (hex). */
  titleColor?: string;

  /** Font family for the title. */
  fontFamily?: string;

  /** Font size for the title. */
  fontSize?: number;

  /** Font style for the title. */
  fontStyle?: "" | "Bold" | "Bold Italic" | "Italic" | "Regular";

  /** Whether the title is underlined. */
  fontUnderline?: boolean;

  /** Image shown when the action is in a multi-action. */
  multiActionImage?: string;
}

// ── Encoder Trigger Descriptions ────────────────────────────────────

export interface ManifestTriggerDescription {
  /** Dial rotation description. */
  rotate?: string;
  /** Dial press description. */
  push?: string;
  /** Touch tap description. */
  touch?: string;
  /** Long touch description. */
  longTouch?: string;
}

// ── Encoder ─────────────────────────────────────────────────────────

export interface ManifestEncoderInfo {
  /**
   * Touch screen layout.  Pre-defined: `$X1`, `$A0`, `$A1`, `$B1`,
   * `$B2`, `$C1`.  Or a path to a custom `.json` layout file.
   */
  layout?: string;

  /** Encoder icon (extension omitted). 72×72 and 144×144 @2x. */
  icon?: string;

  /** Background color for dial stack (hex). */
  stackColor?: string;

  /** Touchscreen background image (extension omitted). 200×100 and 400×200 @2x. */
  background?: string;

  /** Descriptions shown to the user for each interaction type. */
  triggerDescription?: ManifestTriggerDescription;
}

// ── Profile ─────────────────────────────────────────────────────────

export interface ManifestProfileInfo {
  /** Path to .streamDeckProfile file (extension omitted). */
  name: string;

  /**
   * Target device type.
   *
   * Common values:
   *   0 = Stream Deck, 1 = Mini, 2 = XL, 5 = Pedal,
   *   7 = Stream Deck +, 9 = Neo, 10 = Studio
   */
  deviceType: number;

  /** Auto-install when plugin is installed. @default true */
  autoInstall?: boolean;

  /** Don't auto-switch to profile on first install. @default false */
  dontAutoSwitchWhenInstalled?: boolean;

  /** Profile is read-only. @default false */
  readonly?: boolean;
}

// ── Action Manifest Info ────────────────────────────────────────────
//
// Per-action metadata for manifest generation.  Defined on
// defineAction({ info: { ... } }) and carried through the
// ActionDefinition to the bundler plugin.
//
// Controllers auto-derivation:
//   Controllers are derived from the ActionDefinition's key/dial/touchStrip
//   fields — NOT from the info object.  If `controllers` is explicitly
//   set on the info, it overrides the auto-derivation.
//
//   Auto-derivation rules:
//     - key present → includes "Keypad"
//     - dial or touchStrip present → includes "Encoder"
//     - both → ["Keypad", "Encoder"]
//     - neither → ["Keypad"] (default)

export interface ActionManifestInfo {
  // ── Manual Required ───────────────────────────────────────────

  /** Action display name in Stream Deck's action list. */
  name: string;

  /** Path to action icon (extension omitted). 20×20 and 40×40 @2x. */
  icon: string;

  // ── Manual Optional ───────────────────────────────────────────

  /**
   * Skip this action during auto-extraction for manifest generation.
   * The action is still registered at runtime but excluded from the
   * generated manifest.json.
   *
   * @default false
   */
  disabled?: boolean;

  /** Hover tooltip in the actions list. */
  tooltip?: string;

  /**
   * Custom states.  When omitted, a single state is generated
   * using the `icon` field as the state image.
   * @default [{ image: icon }]
   */
  states?: ManifestStateInfo[];

  /** Encoder config (layout, triggerDescription, background). */
  encoder?: ManifestEncoderInfo;

  /** Disable automatic state toggling. @default false */
  disableAutomaticStates?: boolean;

  /** Disable Stream Deck image caching. @default false */
  disableCaching?: boolean;

  /** Available in multi-actions. @default true */
  supportedInMultiActions?: boolean;

  /** Available in key logic actions (SD 7.0+). @default true */
  supportedInKeyLogicActions?: boolean;

  /** Visible in the actions list. @default true */
  visibleInActionsList?: boolean;

  /** Allow user to edit title. @default true */
  userTitleEnabled?: boolean;

  /** Action-specific property inspector HTML path. */
  propertyInspectorPath?: string;

  /** Action support URL. */
  supportUrl?: string;

  /** OS restriction for this action. */
  os?: ("mac" | "windows")[];

  // ── Auto-Derived (overridable) ────────────────────────────────

  /**
   * Controller types.
   *
   * Auto-derived in bundler plugin:
   *   - `encoder` field present → `["Encoder"]`
   *   - otherwise → `["Keypad"]`
   *
   * @default ["Keypad"]
   */
  controllers?: [ManifestController, ManifestController?];
}

// ── Manifest Action Source ──────────────────────────────────────────
//
// @internal
//
// Structural type that ActionDefinition satisfies.  Used internally
// by the manifest generation engine after AST extraction converts
// ExtractedAction → ManifestActionSource.
//
// The generation engine reads:
//   - uuid: from the action definition
//   - info: manifest metadata (name, icon, tooltip, etc.)
//   - key/dial/touchStrip: presence used to derive Controllers

export interface ManifestActionSource {
  uuid: string;
  /** Presence indicates Keypad controller support. */
  key?: unknown;
  /** Presence indicates Encoder controller support. */
  dial?: unknown;
  /** Presence indicates Encoder controller support (touchstrip variant). */
  touchStrip?: unknown;
  /** Action manifest metadata. Required for manifest generation. */
  info?: ActionManifestInfo;
}

// ── Full Manifest Config ────────────────────────────────────────────
//
// @internal
//
// The complete config used by the manifest generation engine.
// Combines plugin-level info with action definitions extracted from
// the module graph at build time.
//
// This type is NOT part of the public API — users provide
// `PluginManifestInfo` in the bundler plugin options, and actions
// are auto-extracted from `defineAction()` calls.

export interface ManifestConfig extends PluginManifestInfo {
  /**
   * Action definitions from defineAction().
   * Each action must have `info` populated with at least `name` and `icon`.
   * Controllers are auto-derived from key/dial/touchStrip presence.
   */
  actions: ManifestActionSource[];
}

// ── Plugin Manifest Info ────────────────────────────────────────────
//
// Plugin-level metadata for manifest generation.
// Required fields have no default — auto-derived fields do.

export interface PluginManifestInfo {
  // ── Manual Required ───────────────────────────────────────────

  /**
   * Unique plugin identifier in reverse-DNS format.
   *
   * All action UUIDs must be prefixed with this value.
   */
  uuid: string;

  /** Plugin display name. */
  name: string;

  /** Author name shown on Marketplace. */
  author: string;

  /** Plugin description. */
  description: string;

  /** Path to plugin icon (extension omitted). 256×256 and 512×512 @2x. */
  icon: string;

  /**
   * Plugin version.
   * @example "1.0.0.0"
   */
  version: string;

  // ── Manual Optional ───────────────────────────────────────────

  /**
   * Actions list group name.
   * @default Same as `name`
   */
  category?: string;

  /**
   * Category icon path (extension omitted).
   * @default Same as `icon`
   */
  categoryIcon?: string;

  /** Plugin website URL. */
  url?: string;

  /** Support website URL. */
  supportUrl?: string;

  /** Global property inspector HTML path. */
  propertyInspectorPath?: string;

  /** Pre-defined profiles distributed with the plugin. */
  profiles?: ManifestProfileInfo[];

  /** Applications to monitor on Mac/Windows. */
  applicationsToMonitor?: { mac?: string[]; windows?: string[] };

  /**
   * Default window size for `window.open()` from the property inspector.
   * @example [500, 650]
   */
  defaultWindowSize?: [number, number];

  /** macOS-specific entry point override. */
  codePathMac?: string;

  /** Windows-specific entry point override. */
  codePathWin?: string;

  // ── Auto-Derived (overridable) ────────────────────────────────

  /**
   * Plugin entry point path.
   * @default Derived from bundler output path (e.g. "bin/plugin.mjs")
   */
  codePath?: string;

  /**
   * Operating system requirements.
   * @default [{ platform: "mac", minimumVersion: "13" }, { platform: "windows", minimumVersion: "10" }]
   */
  os?: [ManifestOSInfo, ManifestOSInfo?];

  /**
   * Node.js configuration.
   * @default { version: "24" }
   */
  nodejs?: ManifestNodejsInfo;

  /**
   * SDK version.
   * @default 2
   */
  sdkVersion?: 2 | 3;

  /**
   * Stream Deck software requirements.
   * @default { minimumVersion: "7.1" }
   */
  software?: { minimumVersion: string };
}
