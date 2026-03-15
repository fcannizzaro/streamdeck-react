import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  ManifestConfig,
  ManifestActionSource,
  ManifestEncoderInfo,
  ManifestTriggerDescription,
  ManifestStateInfo,
  ManifestOSInfo,
  ManifestNodejsInfo,
  ManifestProfileInfo,
  ManifestController,
} from "./manifest-types";

// ── Manifest Generation Engine ──────────────────────────────────────
//
// Transforms a ManifestConfig (camelCase, TypeScript conventions) into
// a valid Elgato Stream Deck manifest.json (PascalCase, Elgato schema).
//
// Pipeline:
//
//   ManifestConfig (user input, camelCase)
//     ↓ validateManifestConfig() — UUID prefix checks, required fields
//     ↓ buildManifestJson() — apply defaults + transform to PascalCase
//     ↓ JSON.stringify()
//     ↓ writeManifestIfChanged() — skip write if content unchanged
//     ↓
//   manifest.json (PascalCase, Elgato schema)
//
// Auto-derivation defaults:
//
//   | Field              | Default                                                             |
//   |--------------------|---------------------------------------------------------------------|
//   | CodePath           | Provided by bundler (e.g. "bin/plugin.mjs")                         |
//   | OS                 | [{ Platform: "mac", Min: "13" }, { Platform: "windows", Min: "10" }]|
//   | Nodejs.Version     | "24"                                                                |
//   | SDKVersion         | 2                                                                   |
//   | Software.MinVer    | "7.1"                                                               |
//   | Category           | Same as Name                                                        |
//   | CategoryIcon       | Same as Icon                                                        |
//   | $schema            | Always added                                                        |
//   | Controllers        | ["Encoder"] if encoder defined, else ["Keypad"]                     |
//   | States             | [{ Image: icon }]                                                   |

// ── Validation ──────────────────────────────────────────────────────

export interface ManifestValidationError {
  field: string;
  message: string;
}

/**
 * Validate just the plugin UUID format.
 *
 * Used in `buildStart` for early error reporting before action
 * extraction is complete.
 *
 * @returns A validation error if the UUID is invalid, or `null` if valid.
 */
export function validatePluginUUID(uuid: string): ManifestValidationError | null {
  if (!/^([a-z0-9-]+)(\.[a-z0-9-]+)+$/.test(uuid)) {
    return {
      field: "uuid",
      message: `Plugin UUID "${uuid}" must be in reverse-DNS format (lowercase alphanumeric, hyphens, periods)`,
    };
  }
  return null;
}

/**
 * Validate a full ManifestConfig for correctness.
 *
 * Checks:
 *   - All action UUIDs are prefixed with the plugin UUID
 *   - No duplicate action UUIDs
 *   - Plugin UUID matches reverse-DNS pattern
 *
 * Called in `writeBundle` after action extraction is complete.
 */
export function validateManifestConfig(
  config: ManifestConfig,
  warn?: (msg: string) => void,
): ManifestValidationError[] {
  const errors: ManifestValidationError[] = [];

  // UUID format check
  const uuidError = validatePluginUUID(config.uuid);
  if (uuidError) {
    errors.push(uuidError);
  }

  const prefix = config.uuid + ".";

  // Action UUID prefix validation
  const seenUuids = new Set<string>();

  for (const action of config.actions) {
    if (!action.uuid.startsWith(prefix)) {
      const error: ManifestValidationError = {
        field: `actions[${action.uuid}].uuid`,
        message: `Action UUID "${action.uuid}" must be prefixed with plugin UUID "${config.uuid}."`,
      };
      errors.push(error);
      warn?.(
        `[@fcannizzaro/streamdeck-react] ${error.message}`,
      );
    }

    if (seenUuids.has(action.uuid)) {
      errors.push({
        field: `actions[${action.uuid}].uuid`,
        message: `Duplicate action UUID "${action.uuid}"`,
      });
    }
    seenUuids.add(action.uuid);
  }

  return errors;
}

// ── JSON Building ───────────────────────────────────────────────────
//
// Each section has a dedicated builder that applies defaults and
// transforms camelCase → PascalCase.  The top-level buildManifestJson
// composes them.
//
// Why explicit builders instead of a generic key-transform?
//   1. Not all keys are simple PascalCase (e.g. `uuid` → `UUID`,
//      `os` → `OS`, `sdkVersion` → `SDKVersion`)
//   2. Auto-derivation logic needs per-field awareness
//   3. Optional fields must be omitted entirely (not set to undefined)
//   4. Explicit code is easier to audit against the Elgato schema

// ── Helpers ─────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonRecord = Record<string, any>;

/** Add a key to the record only if the value is defined. */
function addIf(record: JsonRecord, key: string, value: unknown): void {
  if (value !== undefined && value !== null) {
    record[key] = value;
  }
}

// ── Action Building ─────────────────────────────────────────────────

function buildTriggerDescription(td: ManifestTriggerDescription): JsonRecord {
  const out: JsonRecord = {};
  addIf(out, "Rotate", td.rotate);
  addIf(out, "Push", td.push);
  addIf(out, "Touch", td.touch);
  addIf(out, "LongTouch", td.longTouch);
  return out;
}

function buildEncoder(encoder: ManifestEncoderInfo): JsonRecord {
  const out: JsonRecord = {};
  addIf(out, "layout", encoder.layout);
  addIf(out, "Icon", encoder.icon);
  addIf(out, "StackColor", encoder.stackColor);
  addIf(out, "background", encoder.background);

  if (encoder.triggerDescription) {
    out["TriggerDescription"] = buildTriggerDescription(encoder.triggerDescription);
  }

  return out;
}

function buildState(state: ManifestStateInfo): JsonRecord {
  const out: JsonRecord = { Image: state.image };
  addIf(out, "Name", state.name);
  addIf(out, "Title", state.title);
  addIf(out, "ShowTitle", state.showTitle);
  addIf(out, "TitleAlignment", state.titleAlignment);
  addIf(out, "TitleColor", state.titleColor);
  addIf(out, "FontFamily", state.fontFamily);
  addIf(out, "FontSize", state.fontSize);
  addIf(out, "FontStyle", state.fontStyle);
  addIf(out, "FontUnderline", state.fontUnderline);
  addIf(out, "MultiActionImage", state.multiActionImage);
  return out;
}

/**
 * Derive Controllers from an action definition.
 *
 * Priority:
 *   1. Explicit `controllers` on info → use as-is
 *   2. Derived from key/dial/touchStrip presence:
 *      - key → includes "Keypad"
 *      - dial or touchStrip → includes "Encoder"
 *      - both → ["Keypad", "Encoder"]
 *   3. Default → ["Keypad"]
 */
function deriveControllers(action: ManifestActionSource): ManifestController[] {
  const info = action.info;

  // Explicit override on info
  if (info?.controllers) {
    return info.controllers.filter((c): c is ManifestController => c != null);
  }

  // Derive from component presence
  const hasKey = action.key != null;
  const hasEncoder = action.dial != null || action.touchStrip != null;

  if (hasKey && hasEncoder) return ["Keypad", "Encoder"];
  if (hasEncoder) return ["Encoder"];
  if (hasKey) return ["Keypad"];

  // Fallback: check encoder info
  if (info?.encoder) return ["Encoder"];

  return ["Keypad"];
}

function buildAction(action: ManifestActionSource): JsonRecord {
  const info = action.info;
  if (!info) {
    throw new Error(
      `[@fcannizzaro/streamdeck-react] Action "${action.uuid}" is missing \`info\`. ` +
        `Add info: { name, icon } to the defineAction() call.`,
    );
  }

  const controllers = deriveControllers(action);

  // States: use explicit states or default to [{ Image: icon }]
  const states = info.states
    ? info.states.map(buildState)
    : [{ Image: info.icon }];

  const out: JsonRecord = {
    UUID: action.uuid,
    Name: info.name,
    Icon: info.icon,
    Controllers: controllers,
    States: states,
  };

  addIf(out, "Tooltip", info.tooltip);
  addIf(out, "DisableAutomaticStates", info.disableAutomaticStates);
  addIf(out, "DisableCaching", info.disableCaching);
  addIf(out, "SupportedInMultiActions", info.supportedInMultiActions);
  addIf(out, "SupportedInKeyLogicActions", info.supportedInKeyLogicActions);
  addIf(out, "VisibleInActionsList", info.visibleInActionsList);
  addIf(out, "UserTitleEnabled", info.userTitleEnabled);
  addIf(out, "PropertyInspectorPath", info.propertyInspectorPath);
  addIf(out, "SupportURL", info.supportUrl);

  if (info.encoder) {
    out["Encoder"] = buildEncoder(info.encoder);
  }

  if (info.os) {
    out["OS"] = info.os;
  }

  return out;
}

// ── OS Building ─────────────────────────────────────────────────────

const DEFAULT_OS: [ManifestOSInfo, ManifestOSInfo] = [
  { platform: "mac", minimumVersion: "13" },
  { platform: "windows", minimumVersion: "10" },
];

function buildOS(osEntries: ManifestOSInfo[]): JsonRecord[] {
  return osEntries
    .filter((o): o is ManifestOSInfo => o != null)
    .map((o) => ({
      Platform: o.platform,
      MinimumVersion: o.minimumVersion,
    }));
}

// ── Nodejs Building ─────────────────────────────────────────────────

function buildNodejs(nodejs: ManifestNodejsInfo): JsonRecord {
  const out: JsonRecord = { Version: nodejs.version };
  addIf(out, "Debug", nodejs.debug);
  addIf(out, "GenerateProfilerOutput", nodejs.generateProfilerOutput);
  return out;
}

// ── Profile Building ────────────────────────────────────────────────

function buildProfile(profile: ManifestProfileInfo): JsonRecord {
  const out: JsonRecord = {
    Name: profile.name,
    DeviceType: profile.deviceType,
  };
  addIf(out, "AutoInstall", profile.autoInstall);
  addIf(out, "DontAutoSwitchWhenInstalled", profile.dontAutoSwitchWhenInstalled);
  addIf(out, "Readonly", profile.readonly);
  return out;
}

// ── Top-Level Manifest Building ─────────────────────────────────────

/**
 * Build the full manifest JSON object from a ManifestConfig.
 *
 * Applies all auto-derivation defaults and transforms camelCase
 * to the PascalCase format expected by the Elgato schema.
 *
 * @param config - The manifest configuration
 * @param codePath - Override CodePath (typically derived from bundler output)
 */
export function buildManifestJson(config: ManifestConfig, codePath?: string): JsonRecord {
  const osEntries = config.os
    ? config.os.filter((o): o is ManifestOSInfo => o != null)
    : DEFAULT_OS;

  const nodejs = config.nodejs ?? { version: "24" as const };

  const out: JsonRecord = {
    $schema: "https://schemas.elgato.com/streamdeck/plugins/manifest.json",
    UUID: config.uuid,
    Name: config.name,
    Author: config.author,
    Description: config.description,
    Icon: config.icon,
    Version: config.version,
    CodePath: codePath ?? config.codePath ?? "bin/plugin.mjs",
    OS: buildOS(osEntries),
    Nodejs: buildNodejs(nodejs),
    SDKVersion: config.sdkVersion ?? 2,
    Software: { MinimumVersion: config.software?.minimumVersion ?? "7.1" },
    Category: config.category ?? config.name,
    CategoryIcon: config.categoryIcon ?? config.icon,
    Actions: config.actions.map(buildAction),
  };

  // Optional plugin-level fields
  addIf(out, "URL", config.url);
  addIf(out, "SupportURL", config.supportUrl);
  addIf(out, "PropertyInspectorPath", config.propertyInspectorPath);
  addIf(out, "DefaultWindowSize", config.defaultWindowSize);
  addIf(out, "CodePathMac", config.codePathMac);
  addIf(out, "CodePathWin", config.codePathWin);

  if (config.applicationsToMonitor) {
    out["ApplicationsToMonitor"] = config.applicationsToMonitor;
  }

  if (config.profiles?.length) {
    out["Profiles"] = config.profiles.map(buildProfile);
  }

  return out;
}

// ── Serialization ───────────────────────────────────────────────────

/**
 * Generate the full manifest JSON string from a ManifestConfig.
 *
 * @param config - The manifest configuration
 * @param codePath - Override CodePath (typically derived from bundler output)
 * @returns Formatted JSON string
 */
export function generateManifestJsonString(config: ManifestConfig, codePath?: string): string {
  const json = buildManifestJson(config, codePath);
  return JSON.stringify(json, null, 2) + "\n";
}

// ── File I/O ────────────────────────────────────────────────────────

/**
 * Write manifest.json only when the content has changed.
 * Creates the parent directory if it does not exist.
 *
 * @returns `true` if the file was written, `false` if content was unchanged.
 */
export function writeManifestIfChanged(outPath: string, content: string): boolean {
  if (existsSync(outPath)) {
    const existing = readFileSync(outPath, "utf-8");
    if (existing === content) return false;
  }

  const dir = dirname(outPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(outPath, content);
  return true;
}
