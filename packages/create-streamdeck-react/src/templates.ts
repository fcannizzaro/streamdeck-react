import { minimalPreset } from "./examples/minimal.js";
import { counterPreset } from "./examples/counter.js";
import { zustandPreset } from "./examples/zustand.js";
import { jotaiPreset } from "./examples/jotai.js";
import { pokemonPreset } from "./examples/pokemon.js";

// ── Types ───────────────────────────────────────────────────────────

export type PackageManager = "npm" | "pnpm" | "bun";
export type StarterExample = "minimal" | "counter" | "zustand" | "jotai" | "pokemon";
export type StreamDeckPlatform = "mac" | "windows";
export type NativeBindingsMode = "lazy" | "copy";
export type Adapter = "physical" | "custom";

export interface ScaffoldOptions {
  packageName: string;
  displayName: string;
  pluginUuid: string;
  author: string;
  description: string;
  category: string;
  packageManager: PackageManager;
  example: StarterExample;
  platforms: StreamDeckPlatform[];
  nativeBindings: NativeBindingsMode;
  reactCompiler: boolean;
  adapter: Adapter;
  streamdeckReactVersion: string;
}

export interface ActionIconTemplate {
  id: string;
  name: string;
  colors: {
    from: string;
    to: string;
  };
}

export interface ExamplePreset {
  dependencies: Record<string, string>;
  files: (options: ScaffoldOptions) => Record<string, string>;
  actions: ActionIconTemplate[];
}

interface ExampleOption {
  id: StarterExample;
  label: string;
  description: string;
}

interface ChoiceOption<T extends string> {
  value: T;
  label: string;
  description: string;
}

// ── Constants ───────────────────────────────────────────────────────

const ELGATO_SDK_VERSION = "^2.0.0";

const BASE_DEV_DEPENDENCIES = {
  "@elgato/cli": "^1.7.1",
  "@types/node": "^25.3.3",
  "@types/react": "^19.2.14",
  typescript: "^6.0.0",
  vite: "^8.0.0",
} satisfies Record<string, string>;

const ESBUILD_DEV_DEPENDENCIES = {
  "@vitejs/plugin-react": "^6.0.0",
} satisfies Record<string, string>;

const COMPILER_DEV_DEPENDENCIES = {
  "@babel/core": "^7.29.0",
  "@rolldown/plugin-babel": "^0.2.0",
  "@vitejs/plugin-react": "^6.0.0",
  "babel-plugin-react-compiler": "^1.0.0",
} satisfies Record<string, string>;

// ── Choice Options ──────────────────────────────────────────────────

export const EXAMPLE_OPTIONS: ExampleOption[] = [
  {
    id: "minimal",
    label: "Minimal",
    description: "One key action with local state — best starting point to learn the basics.",
  },
  {
    id: "counter",
    label: "Counter Pack",
    description:
      "Keys, timer, persisted settings, encoder dial, and animated TouchStrip equalizer.",
  },
  {
    id: "zustand",
    label: "Zustand",
    description: "Shared state across keys via Zustand — display, increment, and reset actions.",
  },
  {
    id: "jotai",
    label: "Jotai",
    description: "Shared atom state via Jotai with a plugin-level Provider wrapper.",
  },
  {
    id: "pokemon",
    label: "Pokemon",
    description: "Data fetching with TanStack Query — loads remote Pokemon sprites on key press.",
  },
];

export const PACKAGE_MANAGER_OPTIONS: Array<ChoiceOption<PackageManager>> = [
  { value: "npm", label: "npm", description: "Use npm commands in the generated next steps." },
  { value: "pnpm", label: "pnpm", description: "Use pnpm commands in the generated next steps." },
  { value: "bun", label: "bun", description: "Use Bun commands in the generated next steps." },
];

export const PLATFORM_OPTIONS: Array<ChoiceOption<StreamDeckPlatform>> = [
  { value: "mac", label: "mac", description: "Build a manifest entry for macOS." },
  { value: "windows", label: "windows", description: "Build a manifest entry for Windows." },
];

export const ADAPTER_OPTIONS: Array<ChoiceOption<Adapter>> = [
  {
    value: "physical",
    label: "Physical Device",
    description: "Connect to real Stream Deck hardware via @elgato/streamdeck.",
  },
  {
    value: "custom",
    label: "Custom Adapter",
    description: "Scaffold a custom StreamDeckAdapter implementation.",
  },
];

export const NATIVE_BINDINGS_OPTIONS: Array<ChoiceOption<NativeBindingsMode>> = [
  {
    value: "lazy",
    label: "Lazy (recommended)",
    description: "Download native binary from npm on first plugin startup. No extra packages needed.",
  },
  {
    value: "copy",
    label: "Copy",
    description: "Copy native binary from node_modules at build time. Requires platform packages.",
  },
];

// ── Example Presets ─────────────────────────────────────────────────
//
// Each example is defined in its own file under ./examples/.  The
// preset factory functions are evaluated lazily when buildProjectFiles
// accesses them — this keeps module initialization fast.

const EXAMPLE_PRESETS: Record<StarterExample, () => ExamplePreset> = {
  minimal: minimalPreset,
  counter: counterPreset,
  zustand: zustandPreset,
  jotai: jotaiPreset,
  pokemon: pokemonPreset,
};

// ── Version Resolution ──────────────────────────────────────────────
//
// Queries the npm registry at scaffold time so the generated
// package.json pins a real semver range (^x.y.z) instead of the
// "latest" dist-tag.  Falls back to "latest" when the registry is
// unreachable (offline scaffolding, corporate firewall, etc.).

export async function resolveLatestVersion(packageName: string): Promise<string> {
  try {
    const url = `https://registry.npmjs.org/${packageName}/latest`;
    const response = await fetch(url);

    if (!response.ok) {
      return "latest";
    }

    const data = (await response.json()) as { version?: string };
    const version = data.version;

    if (typeof version === "string" && version.length > 0) {
      return `^${version}`;
    }

    return "latest";
  } catch {
    return "latest";
  }
}

// ── Derivation Helpers ──────────────────────────────────────────────

export function detectPackageManager(userAgent: string | undefined): PackageManager {
  if (userAgent?.includes("pnpm")) return "pnpm";
  if (userAgent?.includes("bun")) return "bun";
  return "npm";
}

export function derivePackageName(projectDir: string): string {
  const normalized = toKebabCase(projectDir);
  return normalized.length > 0 ? normalized : "streamdeck-plugin";
}

export function deriveDisplayName(packageName: string): string {
  return toTitleCase(packageName);
}

export function derivePluginUuid(packageName: string): string {
  return `com.example.${packageName}`;
}

export function validatePluginUuid(uuid: string): boolean {
  return /^[a-z0-9]+(?:[.-][a-z0-9]+)*(?:\.[a-z0-9]+(?:[.-][a-z0-9]+)*)+$/i.test(uuid);
}

export function normalizePlatforms(values: string[]): StreamDeckPlatform[] {
  const normalized = values
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is StreamDeckPlatform => value === "mac" || value === "windows");

  return unique(normalized);
}

// ── Project File Builder ────────────────────────────────────────────

export function buildProjectFiles(options: ScaffoldOptions): Record<string, string> {
  const preset = EXAMPLE_PRESETS[options.example]();
  const pluginDir = `${options.pluginUuid}.sdPlugin`;

  return {
    ".gitignore": createGitignore(),
    "package.json": buildPackageJson(options, preset.dependencies),
    "tsconfig.json": createProjectTsconfig(),
    "vite.config.ts": buildViteConfig(options),
    "README.md": createProjectReadme(options),
    [`${pluginDir}/imgs/plugin-icon.svg`]: createPluginIconSvg(options.displayName),
    ...buildActionIconFiles(pluginDir, preset.actions),
    ...preset.files(options),
  };
}

// ── Vite Config ─────────────────────────────────────────────────────

export function buildViteConfig(
  options: Pick<
    ScaffoldOptions,
    | "pluginUuid"
    | "displayName"
    | "author"
    | "description"
    | "category"
    | "platforms"
    | "nativeBindings"
    | "reactCompiler"
  >,
): string {
  const useCopyMode = options.nativeBindings === "copy";

  // Targets block is only rendered when opting into copy mode.
  const targetsLines: string[] = useCopyMode
    ? ['      nativeBindings: "copy",']
    : [];

  // The os field defaults to both mac 13+ and windows 10+.  When only
  // one platform is selected the generated config must restrict it.
  const hasBothPlatforms =
    options.platforms.includes("mac") && options.platforms.includes("windows");

  const osLines: string[] = hasBothPlatforms
    ? []
    : options.platforms.includes("mac")
      ? ['      os: [{ platform: "mac", minimumVersion: "13" }],']
      : ['      os: [{ platform: "windows", minimumVersion: "10" }],'];

  const compilerImport = options.reactCompiler
    ? [
        'import react, { reactCompilerPreset } from "@vitejs/plugin-react";',
        'import babel from "@rolldown/plugin-babel";',
      ]
    : ['import react from "@vitejs/plugin-react";'];

  const compilerPlugin = options.reactCompiler
    ? [
        "    react(),",
        "    babel({",
        "      presets: [reactCompilerPreset()],",
        "    }),",
      ]
    : ["    react(),"];

  return [
    'import { builtinModules } from "node:module";',
    'import { resolve } from "node:path";',
    'import { defineConfig, esmExternalRequirePlugin } from "vite";',
    ...compilerImport,
    'import { streamDeckReact } from "@fcannizzaro/streamdeck-react/vite";',
    "",
    `const PLUGIN_DIR = "${options.pluginUuid}.sdPlugin";`,
    "const builtins = builtinModules.flatMap((m) => [m, `node:${m}`]);",
    "",
    "export default defineConfig({",
    "  resolve: {",
    '    conditions: ["node"],',
    "  },",
    "  plugins: [",
    "    esmExternalRequirePlugin({ external: builtins }),",
    ...compilerPlugin,
    "    streamDeckReact({",
    ...targetsLines,
    "      manifest: {",
    `        uuid: "${options.pluginUuid}",`,
    `        name: "${options.displayName}",`,
    `        author: "${options.author}",`,
    `        description: "${options.description}",`,
    '        icon: "imgs/plugin-icon",',
    '        version: "0.0.0.1",',
    `        category: "${options.category}",`,
    ...osLines,
    "      },",
    "    }),",
    "  ],",
    "  build: {",
    '    target: "node20",',
    '    outDir: resolve(PLUGIN_DIR, "bin"),',
    "    emptyOutDir: false,",
    "    sourcemap: true,",
    "    minify: false,",
    "    lib: {",
    '      entry: resolve("src/plugin.ts"),',
    '      formats: ["es"],',
    '      fileName: () => "plugin.mjs",',
    "    },",
    "    rolldownOptions: {",
    "      output: {",
    "        codeSplitting: false,",
    "      },",
    "    },",
    "  },",
    "});",
    "",
  ].join("\n");
}

// ── package.json ────────────────────────────────────────────────────

function buildPackageJson(
  options: Pick<
    ScaffoldOptions,
    | "packageName"
    | "description"
    | "reactCompiler"
    | "adapter"
    | "streamdeckReactVersion"
  >,
  exampleDependencies: Record<string, string>,
): string {
  // The @elgato/streamdeck SDK is only required for the physical device adapter.
  // Custom adapters communicate with the hardware through their own mechanism.
  const adapterDependencies: Record<string, string> =
    options.adapter === "physical" ? { "@elgato/streamdeck": ELGATO_SDK_VERSION } : {};

  const extraDevDeps = options.reactCompiler ? COMPILER_DEV_DEPENDENCIES : ESBUILD_DEV_DEPENDENCIES;

  const scripts = {
    build: "vite build",
    dev: "vite build --watch",
    typecheck: "tsc --noEmit",
  };

  const packageJson = {
    name: options.packageName,
    description: options.description,
    private: true,
    version: "0.0.0",
    type: "module",
    scripts,
    dependencies: sortObject({
      "@fcannizzaro/streamdeck-react": options.streamdeckReactVersion,
      react: "^19.2.4",
      ws: "^8.19.0",
      ...adapterDependencies,
      ...exampleDependencies,
    }),
    devDependencies: sortObject({
      ...BASE_DEV_DEPENDENCIES,
      ...extraDevDeps,
    }),
  };

  return `${JSON.stringify(packageJson, null, 2)}\n`;
}

// ── Static Project Files ────────────────────────────────────────────

function buildActionIconFiles(
  pluginDir: string,
  actions: ActionIconTemplate[],
): Record<string, string> {
  return Object.fromEntries(
    actions.map((action) => [
      `${pluginDir}/imgs/actions/${action.id}.svg`,
      createBadgeSvg(action.name, action.colors.from, action.colors.to),
    ]),
  );
}

function createGitignore(): string {
  return [
    "node_modules",
    ".turbo",
    "*.tsbuildinfo",
    "*.sdPlugin/bin/",
    "*.sdPlugin/logs/",
    ".google-fonts/",
    "",
  ].join("\n");
}

function createProjectTsconfig(): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        lib: ["ESNext"],
        target: "ESNext",
        module: "Preserve",
        moduleDetection: "force",
        jsx: "react-jsx",
        moduleResolution: "bundler",
        allowImportingTsExtensions: true,
        verbatimModuleSyntax: true,
        types: ["node"],
        noEmit: true,
        strict: true,
        skipLibCheck: true,
        noFallthroughCasesInSwitch: true,
        noUncheckedIndexedAccess: true,
        noImplicitOverride: true,
      },
      include: ["src"],
    },
    null,
    2,
  )}\n`;
}

function createProjectReadme(options: ScaffoldOptions): string {
  const installCommand = `${options.packageManager} install`;
  const runPrefix = getRunPrefix(options.packageManager);

  const bindingsLine =
    options.nativeBindings === "copy"
      ? "- Native bindings: copy (bundled from node_modules at build time)"
      : "- Native bindings: lazy (downloaded from npm on first startup)";

  return [
    `# ${options.displayName}`,
    "",
    "Generated with `create-streamdeck-react`.",
    "",
    "## Starter",
    "",
    `- Example: ${options.example}`,
    `- Plugin UUID: ${options.pluginUuid}`,
    `- Platforms: ${options.platforms.join(", ")}`,
    bindingsLine,
    "",
    "## Commands",
    "",
    `- Install dependencies: \`${installCommand}\``,
    `- Build: \`${runPrefix} build\``,
    `- Watch: \`${runPrefix} dev\``,
    `- Type-check: \`${runPrefix} typecheck\``,
    "",
    "Install the generated `.sdPlugin` folder in the Stream Deck app after building.",
    "",
  ].join("\n");
}

// ── SVG Generators ──────────────────────────────────────────────────

function createPluginIconSvg(displayName: string): string {
  const initials = getInitials(displayName);

  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144">',
    "  <defs>",
    '    <linearGradient id="plugin-gradient" x1="0%" x2="100%" y1="0%" y2="100%">',
    '      <stop offset="0%" stop-color="#0f172a" />',
    '      <stop offset="100%" stop-color="#2563eb" />',
    "    </linearGradient>",
    "  </defs>",
    '  <rect width="144" height="144" rx="28" fill="url(#plugin-gradient)" />',
    '  <circle cx="72" cy="72" r="42" fill="rgba(255,255,255,0.12)" />',
    `  <text x="72" y="86" text-anchor="middle" font-family="Arial, sans-serif" font-size="42" font-weight="700" fill="#ffffff">${escapeXml(initials)}</text>`,
    "</svg>",
    "",
  ].join("\n");
}

function createBadgeSvg(label: string, from: string, to: string): string {
  const initials = getInitials(label);
  const gradientId = `gradient-${toKebabCase(label)}`;

  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144">',
    "  <defs>",
    `    <linearGradient id="${gradientId}" x1="0%" x2="100%" y1="0%" y2="100%">`,
    `      <stop offset="0%" stop-color="${from}" />`,
    `      <stop offset="100%" stop-color="${to}" />`,
    "    </linearGradient>",
    "  </defs>",
    `  <rect width="144" height="144" rx="24" fill="url(#${gradientId})" />`,
    '  <rect x="18" y="18" width="108" height="108" rx="18" fill="rgba(0,0,0,0.18)" />',
    `  <text x="72" y="84" text-anchor="middle" font-family="Arial, sans-serif" font-size="34" font-weight="700" fill="#ffffff">${escapeXml(initials)}</text>`,
    "</svg>",
    "",
  ].join("\n");
}

// ── Utility Functions ───────────────────────────────────────────────

function getRunPrefix(packageManager: PackageManager): string {
  if (packageManager === "pnpm") return "pnpm";
  if (packageManager === "bun") return "bun run";
  return "npm run";
}

function sortObject(input: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function toKebabCase(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toTitleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getInitials(value: string): string {
  const parts = value.split(/\s+/).filter(Boolean).slice(0, 2);
  const initials = parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
  return initials || "SR";
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
