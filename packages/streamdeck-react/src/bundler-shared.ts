import { createRequire } from "node:module";
import { copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

export type StreamDeckPlatform = "darwin" | "win32";
export type StreamDeckArch = "arm64" | "x64";

export interface StreamDeckTarget {
  platform: StreamDeckPlatform;
  arch: StreamDeckArch;
}

export interface StreamDeckTargetOptions {
  targets?: StreamDeckTarget[];
}

export interface ResolvedTarget extends StreamDeckTarget {
  pkg: string;
  file: string;
}

export const TARGETS: ResolvedTarget[] = [
  {
    platform: "darwin",
    arch: "arm64",
    pkg: "core-darwin-arm64",
    file: "core.darwin-arm64.node",
  },
  {
    platform: "darwin",
    arch: "x64",
    pkg: "core-darwin-x64",
    file: "core.darwin-x64.node",
  },
  {
    platform: "win32",
    arch: "arm64",
    pkg: "core-win32-arm64-msvc",
    file: "core.win32-arm64-msvc.node",
  },
  {
    platform: "win32",
    arch: "x64",
    pkg: "core-win32-x64-msvc",
    file: "core.win32-x64-msvc.node",
  },
];

export function isPlatform(value: string): value is StreamDeckPlatform {
  return value === "darwin" || value === "win32";
}

export function isArch(value: string): value is StreamDeckArch {
  return value === "arm64" || value === "x64";
}

export function isDevelopmentMode(watchMode: boolean | undefined): boolean {
  return watchMode || process.env.NODE_ENV === "development";
}

// ── DevTools stripping constants ────────────────────────────────────
// Used by both Vite and Rollup plugins to replace the devtools module
// with a noop stub in production builds.

export const NOOP_DEVTOOLS_ID = "\0streamdeck-react:noop-devtools";
export const NOOP_DEVTOOLS_CODE = "export function startDevtoolsServer() {}";
const DEVTOOLS_IMPORT_SOURCE = "./devtools/index.js";

/**
 * Returns true when devtools should be stripped from the bundle.
 * Only strips in explicit production mode (NODE_ENV=production) to avoid
 * accidentally removing devtools during one-off development builds.
 */
export function shouldStripDevtools(watchMode: boolean | undefined): boolean {
  if (watchMode) return false;
  return process.env.NODE_ENV === "production";
}

export function isLibraryDevtoolsImport(source: string, importer: string | undefined): boolean {
  if (source !== DEVTOOLS_IMPORT_SOURCE || !importer) return false;
  const normalized = importer.replace(/\\/g, "/");
  return (
    normalized.includes("@fcannizzaro/streamdeck-react/") ||
    normalized.includes("streamdeck-react/dist/")
  );
}

export function resolveTargets(request: StreamDeckTarget): ResolvedTarget[] {
  return TARGETS.filter((target) => {
    if (target.platform !== request.platform || target.arch !== request.arch) {
      return false;
    }
    return true;
  });
}

export function normalizeTargetRequests(
  options: StreamDeckTargetOptions,
  isDevelopment: boolean,
): StreamDeckTarget[] {
  if (options.targets?.length) {
    return options.targets;
  }

  if (!isDevelopment || !isPlatform(process.platform) || !isArch(process.arch)) {
    return [];
  }

  return [
    {
      platform: process.platform,
      arch: process.arch,
    },
  ];
}

export function expandTargets(targets: StreamDeckTarget[]): ResolvedTarget[] {
  const resolved = targets.flatMap((target) => {
    const matches = resolveTargets(target);

    if (matches.length > 0) {
      return matches;
    }

    throw new Error(
      `[@fcannizzaro/streamdeck-react] Unsupported native target: ${target.platform}-${target.arch}`,
    );
  });

  return resolved.filter(
    (target, index) => resolved.findIndex((item) => item.pkg === target.pkg) === index,
  );
}

/**
 * Core logic for copying native bindings to the output directory.
 * Shared between the Rollup and Vite plugins.
 */
export function copyNativeBindings(
  outDir: string,
  isDevelopment: boolean,
  options: StreamDeckTargetOptions,
  warn: (message: string) => void,
): void {
  try {
    const requestedTargets = normalizeTargetRequests(options, isDevelopment);
    if (requestedTargets.length === 0) {
      if (isDevelopment) {
        warn(
          `[@fcannizzaro/streamdeck-react] No native binding available for ${process.platform}-${process.arch}`,
        );
        return;
      }

      throw new Error(
        "[@fcannizzaro/streamdeck-react] streamDeckReact() requires explicit targets when building for production. Pass a `targets` array.",
      );
    }

    const targets = expandTargets(requestedTargets);

    // Resolve from the @takumi-rs/core package location so that its
    // optional dependencies (the platform-specific binding packages)
    // are reachable through Node / Bun module resolution.
    const req = createRequire(import.meta.url);
    const coreEntry = req.resolve("@takumi-rs/core");
    const coreDir = dirname(coreEntry);
    const coreReq = createRequire(join(coreDir, "index.js"));

    const copied: string[] = [];
    const missing: string[] = [];

    for (const target of targets) {
      try {
        // The platform-specific packages don't restrict exports, so we can
        // resolve their package entry to find the directory.
        const bindingEntry = coreReq.resolve(`@takumi-rs/${target.pkg}`);
        const bindingDir = dirname(bindingEntry);
        const src = join(bindingDir, target.file);

        if (!existsSync(src)) {
          missing.push(target.file);
          continue;
        }

        const dest = join(outDir, target.file);
        copyFileSync(src, dest);
        copied.push(target.file);
      } catch {
        missing.push(target.file);
      }
    }

    if (missing.length > 0) {
      const message = `[@fcannizzaro/streamdeck-react] Missing native bindings for ${missing.join(", ")}`;

      if (!isDevelopment) {
        throw new Error(message);
      }

      warn(message);
    }

    if (copied.length === 0) {
      return;
    }

    console.log(`[@fcannizzaro/streamdeck-react] Copied ${copied.join(", ")} -> ${outDir}`);
  } catch (err) {
    if (err instanceof Error) {
      throw err;
    }

    throw new Error(
      `[@fcannizzaro/streamdeck-react] Failed to copy native binding: ${String(err)}`,
    );
  }
}
