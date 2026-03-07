import { createRequire } from "node:module";
import { copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { LogLevel, Plugin, NormalizedOutputOptions, PluginContext, RollupLog } from "rollup";

export type NativeAddonPlatform = "darwin" | "linux" | "win32";
export type NativeAddonArch = "arm64" | "x64";
export type NativeAddonLibc = "gnu" | "musl";

export interface NativeAddonTarget {
  platform: NativeAddonPlatform;
  arch: NativeAddonArch;
}

export interface NativeAddonOptions {
  targets?: NativeAddonTarget[];
}

interface ResolvedTarget extends NativeAddonTarget {
  pkg: string;
  file: string;
}

const TARGETS: ResolvedTarget[] = [
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

function isPlatform(value: string): value is NativeAddonPlatform {
  return value === "darwin" || value === "linux" || value === "win32";
}

function isArch(value: string): value is NativeAddonArch {
  return value === "arm64" || value === "x64";
}

function isDevelopmentMode(watchMode: boolean | undefined): boolean {
  return watchMode || process.env.NODE_ENV === "development";
}

function resolveTargets(request: NativeAddonTarget): ResolvedTarget[] {
  return TARGETS.filter((target) => {
    if (target.platform !== request.platform || target.arch !== request.arch) {
      return false;
    }
    return true;
  });
}

function normalizeTargetRequests(
  options: NativeAddonOptions,
  isDevelopment: boolean,
): NativeAddonTarget[] {
  if (options.targets?.length) {
    return options.targets;
  }

  if (!isDevelopment || !isPlatform(process.platform) || !isArch(process.arch)) {
    return [];
  }

  return [{
    platform: process.platform,
    arch: process.arch,
  }];
}

function expandTargets(targets: NativeAddonTarget[]): ResolvedTarget[] {
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
 * Rollup plugin that copies the `@takumi-rs/core` platform-specific native
 * binding (`.node` file) into the bundle output directory so the Stream Deck
 * Node.js runtime can find it at startup.
 */
export function nativeAddon(options: NativeAddonOptions = {}): Plugin {
  return {
    name: "fcannizzaro-streamdeck-react-native-addon",
    onLog(_level: LogLevel, log: RollupLog) {
      if (log.code === "MODULE_LEVEL_DIRECTIVE") return false;
    },
    writeBundle(this: PluginContext, outputOptions: NormalizedOutputOptions) {
      const isDevelopment = isDevelopmentMode(this.meta.watchMode);

      const outDir = outputOptions.file ? dirname(outputOptions.file) : outputOptions.dir;
      if (!outDir) return;

      try {
        const requestedTargets = normalizeTargetRequests(options, isDevelopment);
        if (requestedTargets.length === 0) {
          if (isDevelopment) {
            this.warn(
              `[@fcannizzaro/streamdeck-react] No native binding available for ${process.platform}-${process.arch}`,
            );
            return;
          }

          throw new Error(
            "[@fcannizzaro/streamdeck-react] nativeAddon() requires explicit targets when building for production. Pass a `targets` array.",
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

          this.warn(message);
        }

        if (copied.length === 0) {
          return;
        }

        console.log(
          `[@fcannizzaro/streamdeck-react] Copied ${copied.join(", ")} -> ${outDir}`,
        );
      } catch (err) {
        if (err instanceof Error) {
          throw err;
        }

        throw new Error(
          `[@fcannizzaro/streamdeck-react] Failed to copy native binding: ${String(err)}`,
        );
      }
    },
  };
}
