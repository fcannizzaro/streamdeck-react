#!/usr/bin/env node

import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import * as p from "@clack/prompts";
import {
  EXAMPLE_OPTIONS,
  PACKAGE_MANAGER_OPTIONS,
  PLATFORM_OPTIONS,
  TARGET_OPTIONS,
  buildProjectFiles,
  detectPackageManager,
  deriveDisplayName,
  deriveNativeTargets,
  derivePackageName,
  derivePluginUuid,
  normalizePlatforms,
  normalizeTargets,
  validatePlatformTargets,
  validatePluginUuid,
  type NativeTargetId,
  type PackageManager,
  type ScaffoldOptions,
  type StarterExample,
  type StreamDeckPlatform,
} from "./templates.js";

type ParsedArgs = {
  directory?: string;
  yes: boolean;
  help: boolean;
  example?: StarterExample;
  displayName?: string;
  pluginUuid?: string;
  author?: string;
  description?: string;
  category?: string;
  packageManager?: PackageManager;
  platforms?: StreamDeckPlatform[];
  nativeTargets?: NativeTargetId[];
  reactCompiler?: boolean;
};

function assertNotCancelled<T>(value: T | symbol): asserts value is T {
  if (p.isCancel(value)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  const skipPrompt = args.yes || !process.stdout.isTTY;

  if (!skipPrompt) {
    p.intro("create-streamdeck-react");
  }

  const targetDirectory = await collectTargetDirectory(args, skipPrompt);
  const packageName = derivePackageName(basename(targetDirectory));
  const displayName = await collectDisplayName(args, packageName, skipPrompt);
  const pluginUuid = await collectPluginUuid(args, packageName, skipPrompt);
  const author = await collectAuthor(args, skipPrompt);
  const description = await collectDescription(args, displayName, skipPrompt);
  const category = await collectCategory(args, displayName, skipPrompt);
  const packageManager = await collectPackageManager(args, skipPrompt);
  const example = await collectExample(args, skipPrompt);
  const platforms = await collectPlatforms(args, skipPrompt);
  const nativeTargets = await collectNativeTargets(args, platforms, skipPrompt);
  const reactCompiler = await collectReactCompiler(args, skipPrompt);

  validatePlatformTargets(platforms, nativeTargets);

  const options: ScaffoldOptions = {
    packageName,
    displayName,
    pluginUuid,
    author,
    description,
    category,
    packageManager,
    example,
    platforms,
    nativeTargets,
    reactCompiler,
  };

  createProject(targetDirectory, options);

  let installed = false;
  let linked = false;

  if (!skipPrompt) {
    const shouldInstall = await p.confirm({
      message: "Install dependencies?",
    });

    assertNotCancelled(shouldInstall);

    if (shouldInstall) {
      const s = p.spinner();
      s.start(`Running ${options.packageManager} install`);

      try {
        execSync(`${options.packageManager} install`, {
          cwd: targetDirectory,
          stdio: "pipe",
        });
        s.stop(`Dependencies installed`);
        installed = true;
      } catch (error) {
        const stderr = error instanceof Error && "stderr" in error
          ? String((error as { stderr: unknown }).stderr).trim()
          : "";
        s.stop(stderr ? `Failed to install dependencies: ${stderr}` : `Failed to install dependencies`);
      }
    }

    const shouldLink = await p.confirm({
      message: "Link plugin to Stream Deck?",
    });

    assertNotCancelled(shouldLink);

    if (shouldLink) {
      const s = p.spinner();
      const pluginDir = `${options.pluginUuid}.sdPlugin`;
      s.start(`Linking ${pluginDir}`);

      try {
        const linkCommand = buildLinkCommand(options.packageManager, pluginDir);
        execSync(linkCommand, {
          cwd: targetDirectory,
          stdio: "pipe",
        });
        s.stop(`Plugin linked to Stream Deck`);
        linked = true;
      } catch (error) {
        const stderr = error instanceof Error && "stderr" in error
          ? String((error as { stderr: unknown }).stderr).trim()
          : "";
        s.stop(stderr ? `Failed to link plugin: ${stderr}` : `Failed to link plugin`);
      }
    }
  }

  printSuccess(targetDirectory, options, skipPrompt, installed, linked);
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    yes: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg) continue;

    if (arg === "-y" || arg === "--yes") {
      parsed.yes = true;
      continue;
    }

    if (arg === "-h" || arg === "--help") {
      parsed.help = true;
      continue;
    }

    if (!arg.startsWith("-")) {
      parsed.directory ??= arg;
      continue;
    }

    const [flag, inlineValue] = arg.split("=", 2);
    const nextValue = inlineValue ?? argv[index + 1];
    const consumeNext = inlineValue === undefined;

    switch (flag) {
      case "--example":
        parsed.example = parseExample(nextValue);
        break;
      case "--name":
        parsed.displayName = nextValue;
        break;
      case "--uuid":
        parsed.pluginUuid = nextValue;
        break;
      case "--author":
        parsed.author = nextValue;
        break;
      case "--description":
        parsed.description = nextValue;
        break;
      case "--category":
        parsed.category = nextValue;
        break;
      case "--package-manager":
        parsed.packageManager = parsePackageManager(nextValue);
        break;
      case "--platforms":
        parsed.platforms = normalizePlatforms(splitCsv(nextValue));
        break;
      case "--targets":
        parsed.nativeTargets = normalizeTargets(splitCsv(nextValue));
        break;
      case "--react-compiler":
        parsed.reactCompiler = nextValue === "true" || nextValue === "yes";
        break;
      default:
        throw new Error(`Unknown argument: ${flag}`);
    }

    if (consumeNext) {
      index += 1;
    }
  }

  return parsed;
}

async function collectTargetDirectory(
  args: ParsedArgs,
  skipPrompt: boolean,
): Promise<string> {
  const provided = args.directory?.trim();

  if (provided) {
    return resolve(process.cwd(), provided);
  }

  if (skipPrompt) {
    return resolve(process.cwd(), "streamdeck-plugin");
  }

  const answer = await p.text({
    message: "Project directory",
    initialValue: "streamdeck-plugin",
  });

  assertNotCancelled(answer);
  return resolve(process.cwd(), answer.trim() || "streamdeck-plugin");
}

async function collectDisplayName(
  args: ParsedArgs,
  packageName: string,
  skipPrompt: boolean,
): Promise<string> {
  const fallback = deriveDisplayName(packageName);
  const displayName = args.displayName?.trim();

  if (displayName) {
    return displayName;
  }

  if (skipPrompt) {
    return fallback;
  }

  const answer = await p.text({
    message: "Plugin name",
    initialValue: fallback,
  });

  assertNotCancelled(answer);
  return answer.trim() || fallback;
}

async function collectPluginUuid(
  args: ParsedArgs,
  packageName: string,
  skipPrompt: boolean,
): Promise<string> {
  const fallback = derivePluginUuid(packageName);
  const provided = args.pluginUuid?.trim();

  if (provided) {
    if (!validatePluginUuid(provided)) {
      throw new Error(`Invalid plugin UUID: ${provided}`);
    }

    return provided;
  }

  if (skipPrompt) {
    return fallback;
  }

  const answer = await p.text({
    message: "Plugin UUID",
    initialValue: fallback,
    validate(value) {
      if (!value || !validatePluginUuid(value)) {
        return "Use a reverse-domain style UUID like com.example.my-plugin.";
      }
    },
  });

  assertNotCancelled(answer);
  return answer;
}

async function collectAuthor(
  args: ParsedArgs,
  skipPrompt: boolean,
): Promise<string> {
  const fallback =
    process.env.npm_config_init_author_name ??
    process.env.GIT_AUTHOR_NAME ??
    process.env.USER ??
    "Your Name";

  if (args.author?.trim()) {
    return args.author.trim();
  }

  if (skipPrompt) {
    return fallback;
  }

  const answer = await p.text({
    message: "Author",
    initialValue: fallback,
  });

  assertNotCancelled(answer);
  return answer.trim() || fallback;
}

async function collectDescription(
  args: ParsedArgs,
  displayName: string,
  skipPrompt: boolean,
): Promise<string> {
  const fallback = `${displayName} built with @fcannizzaro/streamdeck-react.`;

  if (args.description?.trim()) {
    return args.description.trim();
  }

  if (skipPrompt) {
    return fallback;
  }

  const answer = await p.text({
    message: "Description",
    initialValue: fallback,
  });

  assertNotCancelled(answer);
  return answer.trim() || fallback;
}

async function collectCategory(
  args: ParsedArgs,
  displayName: string,
  skipPrompt: boolean,
): Promise<string> {
  if (args.category?.trim()) {
    return args.category.trim();
  }

  if (skipPrompt) {
    return displayName;
  }

  const answer = await p.text({
    message: "Category",
    initialValue: displayName,
  });

  assertNotCancelled(answer);
  return answer.trim() || displayName;
}

async function collectPackageManager(
  args: ParsedArgs,
  skipPrompt: boolean,
): Promise<PackageManager> {
  if (args.packageManager) {
    return args.packageManager;
  }

  const fallback = detectPackageManager(process.env.npm_config_user_agent);

  if (skipPrompt) {
    return fallback;
  }

  const answer = await p.select({
    message: "Package manager",
    options: PACKAGE_MANAGER_OPTIONS.map((option) => ({
      value: option.value as PackageManager,
      label: option.label,
      hint: option.description,
    })),
    initialValue: fallback,
  });

  assertNotCancelled(answer);
  return answer;
}

async function collectExample(
  args: ParsedArgs,
  skipPrompt: boolean,
): Promise<StarterExample> {
  if (args.example) {
    return args.example;
  }

  const fallback: StarterExample = "counter";

  if (skipPrompt) {
    return fallback;
  }

  const answer = await p.select({
    message: "Starter example",
    options: EXAMPLE_OPTIONS.map((option) => ({
      value: option.id as StarterExample,
      label: option.label,
      hint: option.description,
    })),
    initialValue: fallback,
  });

  assertNotCancelled(answer);
  return answer;
}

async function collectPlatforms(
  args: ParsedArgs,
  skipPrompt: boolean,
): Promise<StreamDeckPlatform[]> {
  if (args.platforms?.length) {
    return args.platforms;
  }

  const fallback: StreamDeckPlatform[] = ["mac", "windows"];

  if (skipPrompt) {
    return fallback;
  }

  const answer = await p.multiselect({
    message: "Supported platforms",
    options: PLATFORM_OPTIONS.map((option) => ({
      value: option.value as StreamDeckPlatform,
      label: option.label,
      hint: option.description,
    })),
    initialValues: fallback,
  });

  assertNotCancelled(answer);
  return answer;
}

async function collectNativeTargets(
  args: ParsedArgs,
  platforms: StreamDeckPlatform[],
  skipPrompt: boolean,
): Promise<NativeTargetId[]> {
  if (args.nativeTargets?.length) {
    return args.nativeTargets;
  }

  const fallback = deriveNativeTargets(platforms);

  if (skipPrompt) {
    return fallback;
  }

  const answer = await p.multiselect({
    message: "Native addon targets",
    options: TARGET_OPTIONS.map((option) => ({
      value: option.value as NativeTargetId,
      label: option.label,
      hint: option.description,
    })),
    initialValues: fallback,
  });

  assertNotCancelled(answer);
  return answer;
}

async function collectReactCompiler(
  args: ParsedArgs,
  skipPrompt: boolean,
): Promise<boolean> {
  if (args.reactCompiler !== undefined) {
    return args.reactCompiler;
  }

  if (skipPrompt) {
    return false;
  }

  const answer = await p.confirm({
    message: "Use React Compiler?",
    initialValue: false,
  });

  assertNotCancelled(answer);
  return answer;
}

function createProject(targetDirectory: string, options: ScaffoldOptions): void {
  ensureDirectoryIsSafe(targetDirectory);

  const files = buildProjectFiles(options);

  mkdirSync(targetDirectory, { recursive: true });

  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = resolve(targetDirectory, relativePath);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, "utf8");
  }

  const fontSource = new URL("../assets/Inter-Regular.ttf", import.meta.url);
  const fontDestination = resolve(
    targetDirectory,
    "fonts/Inter-Regular.ttf",
  );

  mkdirSync(dirname(fontDestination), { recursive: true });
  copyFileSync(fontSource, fontDestination);

}

function buildLinkCommand(packageManager: PackageManager, pluginDir: string): string {
  switch (packageManager) {
    case "pnpm":
      return `pnpm exec streamdeck link ${pluginDir}`;
    case "bun":
      return `bunx @elgato/cli link ${pluginDir}`;
    default:
      return `npx @elgato/cli link ${pluginDir}`;
  }
}

function ensureDirectoryIsSafe(targetDirectory: string): void {
  if (!existsSync(targetDirectory)) {
    return;
  }

  const contents = readdirSync(targetDirectory);
  if (contents.length > 0) {
    throw new Error(`Target directory is not empty: ${targetDirectory}`);
  }
}

function printSuccess(
  targetDirectory: string,
  options: ScaffoldOptions,
  skipPrompt: boolean,
  installed: boolean,
  linked: boolean,
): void {
  const relativeTarget = relative(process.cwd(), targetDirectory) || ".";
  const runPrefix =
    options.packageManager === "pnpm"
      ? "pnpm"
      : options.packageManager === "bun"
        ? "bun"
        : "npm run";

  const steps: string[] = [];
  steps.push(`cd ${relativeTarget}`);

  if (!installed) {
    steps.push(`${options.packageManager} install`);
  }

  if (!linked) {
    const pluginDir = `${options.pluginUuid}.sdPlugin`;
    steps.push(buildLinkCommand(options.packageManager, pluginDir));
  }

  steps.push(`${runPrefix} dev`);

  if (skipPrompt) {
    console.log("");
    console.log(`Created ${options.displayName} in ${relativeTarget}`);
    console.log("");
    console.log("Next steps:");
    for (const step of steps) {
      console.log(`  ${step}`);
    }
    return;
  }

  p.note(steps.join("\n"), "Next steps");
  p.outro(`Created ${options.displayName} in ${relativeTarget}`);
}

function parseExample(value: string | undefined): StarterExample | undefined {
  if (!value) return undefined;

  const normalized = value.trim().toLowerCase();
  const option = EXAMPLE_OPTIONS.find((entry) => entry.id === normalized);
  return option?.id;
}

function parsePackageManager(value: string | undefined): PackageManager | undefined {
  if (!value) return undefined;
  if (value === "npm" || value === "pnpm" || value === "bun") return value;
  throw new Error(`Unsupported package manager: ${value}`);
}

function splitCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(",").map((part: string) => part.trim()).filter(Boolean);
}

function printHelp(): void {
  console.log(`create-streamdeck-react

Usage:
  npm create streamdeck-react@latest [directory]
  pnpm create streamdeck-react [directory]
  bun create streamdeck-react [directory]

Options:
  -y, --yes                  Skip prompts and use defaults
  -h, --help                 Show this help message
  --example <name>           minimal | counter | zustand | jotai | pokemon
  --name <display-name>      Plugin display name
  --uuid <plugin-uuid>       Reverse-domain plugin UUID
  --author <name>            Manifest author
  --description <text>       Manifest description
  --category <text>          Manifest category
  --package-manager <pm>     npm | pnpm | bun
  --platforms <list>         Comma-separated: mac,windows
  --targets <list>           Comma-separated native targets
  --react-compiler <bool>    Enable React Compiler (true | false)
`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nError: ${message}`);
  process.exitCode = 1;
});
