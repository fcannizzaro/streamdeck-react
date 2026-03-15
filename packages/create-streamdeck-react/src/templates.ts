export type PackageManager = "npm" | "pnpm" | "bun";
export type Bundler = "rollup" | "rolldown";
export type StarterExample = "minimal" | "counter" | "zustand" | "jotai" | "pokemon";
export type StreamDeckPlatform = "mac" | "windows";
export type NativeTargetId = "darwin-arm64" | "darwin-x64" | "win32-arm64" | "win32-x64";
export type Adapter = "physical" | "custom";

export interface ScaffoldOptions {
  packageName: string;
  displayName: string;
  pluginUuid: string;
  author: string;
  description: string;
  category: string;
  packageManager: PackageManager;
  bundler: Bundler;
  example: StarterExample;
  platforms: StreamDeckPlatform[];
  nativeTargets: NativeTargetId[];
  reactCompiler: boolean;
  adapter: Adapter;
  streamdeckReactVersion: string;
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

interface ManifestActionTemplate {
  id: string;
  name: string;
  tooltip: string;
  controllers: Array<"Keypad" | "Encoder">;
  encoder?: {
    layout: string;
    rotate: string;
    press: string;
    touch?: string;
  };
  colors: {
    from: string;
    to: string;
  };
}

interface ExamplePreset {
  dependencies: Record<string, string>;
  files: (options: ScaffoldOptions) => Record<string, string>;
  actions: ManifestActionTemplate[];
}

const TAKUMI_VERSION = "^0.71.7";
const ELGATO_SDK_VERSION = "^2.0.0";

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

const BASE_DEV_DEPENDENCIES = {
  "@elgato/cli": "^1.7.1",
  "@rollup/plugin-commonjs": "^29.0.0",
  "@rollup/plugin-json": "^6.1.0",
  "@rollup/plugin-node-resolve": "^16.0.3",
  "@types/node": "^25.3.3",
  "@types/react": "^19.2.14",
  rollup: "^4.59.0",
  typescript: "^5.9.3",
} satisfies Record<string, string>;

const ESBUILD_DEV_DEPENDENCIES = {
  "rollup-plugin-esbuild": "^6.2.1",
} satisfies Record<string, string>;

const COMPILER_DEV_DEPENDENCIES = {
  "@babel/core": "^7.28.0",
  "@babel/preset-react": "^7.28.0",
  "@babel/preset-typescript": "^7.28.0",
  "@rollup/plugin-babel": "^6.0.4",
  "babel-plugin-react-compiler": "latest",
} satisfies Record<string, string>;

const ROLLDOWN_BASE_DEV_DEPENDENCIES = {
  "@elgato/cli": "^1.7.1",
  "@types/node": "^25.3.3",
  "@types/react": "^19.2.14",
  typescript: "^5.9.3",
  vite: "8.0.0",
} satisfies Record<string, string>;

const ROLLDOWN_ESBUILD_DEV_DEPENDENCIES = {
  "@vitejs/plugin-react": "6.0.1",
} satisfies Record<string, string>;

const ROLLDOWN_COMPILER_DEV_DEPENDENCIES = {
  "@babel/core": "^7.29.0",
  "@rolldown/plugin-babel": "^0.2.0",
  "@vitejs/plugin-react": "6.0.1",
  "babel-plugin-react-compiler": "^1.0.0",
} satisfies Record<string, string>;

const TARGET_PACKAGE_MAP: Record<NativeTargetId, string> = {
  "darwin-arm64": "@takumi-rs/core-darwin-arm64",
  "darwin-x64": "@takumi-rs/core-darwin-x64",
  "win32-arm64": "@takumi-rs/core-win32-arm64-msvc",
  "win32-x64": "@takumi-rs/core-win32-x64-msvc",
};

export const EXAMPLE_OPTIONS: ExampleOption[] = [
  {
    id: "minimal",
    label: "Minimal",
    description: "One key action with local state — best starting point to learn the basics.",
  },
  {
    id: "counter",
    label: "Counter Pack",
    description: "Keys, timer, persisted settings, encoder dial, and animated TouchStrip equalizer.",
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

export const BUNDLER_OPTIONS: Array<ChoiceOption<Bundler>> = [
  {
    value: "rolldown",
    label: "Rolldown (Vite 8+)",
    description: "Vite 8+ with Rolldown and Oxc transforms.",
  },
  {
    value: "rollup",
    label: "Rollup",
    description: "Stable Rollup-based build with esbuild or Babel.",
  },
];

export const PLATFORM_OPTIONS: Array<ChoiceOption<StreamDeckPlatform>> = [
  { value: "mac", label: "mac", description: "Build a manifest entry for macOS." },
  { value: "windows", label: "windows", description: "Build a manifest entry for Windows." },
];

export const TARGET_OPTIONS: Array<ChoiceOption<NativeTargetId>> = [
  { value: "darwin-arm64", label: "darwin-arm64", description: "Apple Silicon macOS build." },
  { value: "darwin-x64", label: "darwin-x64", description: "Intel macOS build." },
  { value: "win32-arm64", label: "win32-arm64", description: "Windows on ARM build." },
  { value: "win32-x64", label: "win32-x64", description: "Windows x64 build." },
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

const EXAMPLE_PRESETS: Record<StarterExample, ExamplePreset> = {
  minimal: {
    dependencies: {},
    actions: [
      {
        id: "status",
        name: "Status",
        tooltip: "Toggles between standby and live mode.",
        controllers: ["Keypad"],
        colors: { from: "#0f766e", to: "#164e63" },
      },
    ],
    files: (options) => ({
      "src/actions/status.tsx": createMinimalAction(options.pluginUuid),
      ...createAdapterFiles(options.adapter),
      "src/plugin.ts": createPluginEntrypoint(["statusAction"], undefined, options.adapter),
    }),
  },
  counter: {
    dependencies: {},
    actions: [
      {
        id: "counter",
        name: "Counter",
        tooltip: "A simple counter that increments on every key press.",
        controllers: ["Keypad"],
        colors: { from: "#2563eb", to: "#1d4ed8" },
      },
      {
        id: "timer",
        name: "Timer",
        tooltip: "A stopwatch that starts and stops on key press.",
        controllers: ["Keypad"],
        colors: { from: "#1b5e20", to: "#212121" },
      },
      {
        id: "toggle",
        name: "Toggle",
        tooltip: "Cycles through Off, Auto, and On settings.",
        controllers: ["Keypad"],
        colors: { from: "#f57f17", to: "#b71c1c" },
      },
      {
        id: "volume",
        name: "Volume",
        tooltip: "Adjust volume on the encoder and press to mute.",
        controllers: ["Encoder"],
        encoder: {
          layout: "$A0",
          rotate: "Adjust volume",
          press: "Mute / Unmute",
        },
        colors: { from: "#1a1a1a", to: "#4a0000" },
      },
      {
        id: "equalizer",
        name: "Equalizer",
        tooltip: "Animated equalizer across the full touch strip.",
        controllers: ["Encoder"],
        encoder: {
          layout: "layouts/touchstrip.json",
          rotate: "Adjust speed / amplitude",
          press: "Pause / Reset",
          touch: "Change color theme",
        },
        colors: { from: "#667eea", to: "#764ba2" },
      },
    ],
    files: (options) => ({
      "src/actions/counter.tsx": createCounterAction(options.pluginUuid),
      "src/actions/timer.tsx": createTimerAction(options.pluginUuid),
      "src/actions/toggle.tsx": createToggleAction(options.pluginUuid),
      "src/actions/volume.tsx": createVolumeAction(options.pluginUuid),
      "src/actions/equalizer.tsx": createEqualizerAction(options.pluginUuid),
      [`${options.pluginUuid}.sdPlugin/layouts/touchstrip.json`]: createTouchStripLayout(),
      ...createAdapterFiles(options.adapter),
      "src/plugin.ts": createPluginEntrypoint(
        ["counterAction", "timerAction", "toggleAction", "volumeAction", "equalizerAction"],
        undefined,
        options.adapter,
      ),
    }),
  },
  zustand: {
    dependencies: {
      zustand: "^5.0.8",
    },
    actions: [
      {
        id: "display",
        name: "Shared Display",
        tooltip: "Shows the current Zustand value shared across actions.",
        controllers: ["Keypad"],
        colors: { from: "#12343b", to: "#bfdbf7" },
      },
      {
        id: "increment",
        name: "Increment",
        tooltip: "Increments the shared Zustand counter.",
        controllers: ["Keypad"],
        colors: { from: "#ee964b", to: "#f95738" },
      },
      {
        id: "reset",
        name: "Reset",
        tooltip: "Resets the shared Zustand store.",
        controllers: ["Keypad"],
        colors: { from: "#2f2d2e", to: "#575761" },
      },
    ],
    files: (options) => ({
      "src/store.ts": createZustandStore(),
      "src/actions/display.tsx": createZustandDisplayAction(options.pluginUuid),
      "src/actions/increment.tsx": createZustandIncrementAction(options.pluginUuid),
      "src/actions/reset.tsx": createZustandResetAction(options.pluginUuid),
      ...createAdapterFiles(options.adapter),
      "src/plugin.ts": createPluginEntrypoint(
        ["displayAction", "incrementAction", "resetAction"],
        undefined,
        options.adapter,
      ),
    }),
  },
  jotai: {
    dependencies: {
      jotai: "^2.12.5",
    },
    actions: [
      {
        id: "display",
        name: "Atom Display",
        tooltip: "Shows the current Jotai value shared by the plugin wrapper.",
        controllers: ["Keypad"],
        colors: { from: "#0b132b", to: "#3a506b" },
      },
      {
        id: "increment",
        name: "Increment Atom",
        tooltip: "Writes to the shared Jotai atom.",
        controllers: ["Keypad"],
        colors: { from: "#5bc0be", to: "#6fffe9" },
      },
      {
        id: "reset",
        name: "Reset Atom",
        tooltip: "Resets the shared Jotai state.",
        controllers: ["Keypad"],
        colors: { from: "#1b1b1e", to: "#2b2d42" },
      },
    ],
    files: (options) => ({
      "src/store.ts": createJotaiStore(),
      "src/wrapper.tsx": createJotaiWrapper(),
      "src/actions/display.tsx": createJotaiDisplayAction(options.pluginUuid),
      "src/actions/increment.tsx": createJotaiIncrementAction(options.pluginUuid),
      "src/actions/reset.tsx": createJotaiResetAction(options.pluginUuid),
      ...createAdapterFiles(options.adapter),
      "src/plugin.ts": createPluginEntrypoint(
        ["displayAction", "incrementAction", "resetAction"],
        "JotaiWrapper",
        options.adapter,
      ),
    }),
  },
  pokemon: {
    dependencies: {
      "@tanstack/react-query": "^5.72.2",
    },
    actions: [
      {
        id: "pokemon",
        name: "Random Pokemon",
        tooltip: "Fetches and displays a random Pokemon sprite on each key press.",
        controllers: ["Keypad"],
        colors: { from: "#0f3460", to: "#533483" },
      },
    ],
    files: (options) => ({
      "src/actions/pokemon.tsx": createPokemonAction(options.pluginUuid),
      "src/wrapper.tsx": createQueryWrapper(),
      ...createAdapterFiles(options.adapter),
      "src/plugin.ts": createPluginEntrypoint(["pokemonAction"], "QueryWrapper", options.adapter),
    }),
  },
};

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

export function deriveNativeTargets(platforms: StreamDeckPlatform[]): NativeTargetId[] {
  const next: NativeTargetId[] = [];

  if (platforms.includes("mac")) {
    next.push("darwin-arm64");
  }

  if (platforms.includes("windows")) {
    next.push("win32-x64");
  }

  return next;
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

export function normalizeTargets(values: string[]): NativeTargetId[] {
  const normalized = values
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is NativeTargetId => value in TARGET_PACKAGE_MAP);

  return unique(normalized);
}

export function validatePlatformTargets(
  platforms: StreamDeckPlatform[],
  nativeTargets: NativeTargetId[],
): void {
  if (platforms.length === 0) {
    throw new Error("Select at least one platform.");
  }

  if (nativeTargets.length === 0) {
    throw new Error("Select at least one native target.");
  }

  const hasMacTarget = nativeTargets.some((target) => target.startsWith("darwin-"));
  const hasWindowsTarget = nativeTargets.some((target) => target.startsWith("win32-"));

  if (platforms.includes("mac") && !hasMacTarget) {
    throw new Error("macOS support requires at least one darwin native target.");
  }

  if (!platforms.includes("mac") && hasMacTarget) {
    throw new Error("Remove darwin native targets or include mac in the supported platforms.");
  }

  if (platforms.includes("windows") && !hasWindowsTarget) {
    throw new Error("Windows support requires at least one win32 native target.");
  }

  if (!platforms.includes("windows") && hasWindowsTarget) {
    throw new Error("Remove win32 native targets or include windows in the supported platforms.");
  }
}

export function buildProjectFiles(options: ScaffoldOptions): Record<string, string> {
  validatePlatformTargets(options.platforms, options.nativeTargets);

  const preset = EXAMPLE_PRESETS[options.example];
  const pluginDir = `${options.pluginUuid}.sdPlugin`;

  const configFile: Record<string, string> =
    options.bundler === "rolldown"
      ? { "vite.config.ts": buildViteConfig(options) }
      : { "rollup.config.mjs": buildRollupConfig(options) };

  return {
    ".gitignore": createGitignore(),
    "package.json": buildPackageJson(options, preset.dependencies),
    "tsconfig.json": createProjectTsconfig(),
    ...configFile,
    "README.md": createProjectReadme(options),
    [`${pluginDir}/manifest.json`]: buildManifest(options, preset.actions),
    [`${pluginDir}/imgs/plugin-icon.svg`]: createPluginIconSvg(options.displayName),
    [`${pluginDir}/bin/.gitkeep`]: "",
    [`${pluginDir}/logs/.gitkeep`]: "",
    ...buildActionIconFiles(pluginDir, preset.actions),
    ...preset.files(options),
  };
}

export function buildRollupConfig(
  options: Pick<ScaffoldOptions, "pluginUuid" | "displayName" | "author" | "description" | "category" | "nativeTargets" | "reactCompiler">,
): string {
  const renderedTargets = options.nativeTargets
    .map((target) => {
      const [platform, arch] = target.split("-");
      return `      { platform: "${platform}", arch: "${arch}" },`;
    })
    .join("\n");

  const transformImport = options.reactCompiler
    ? 'import { babel } from "@rollup/plugin-babel";'
    : 'import esbuild from "rollup-plugin-esbuild";';

  const transformPlugin = options.reactCompiler
    ? [
        "    babel({",
        '      babelHelpers: "bundled",',
        '      extensions: [".js", ".jsx", ".ts", ".tsx"],',
        '      exclude: "**/node_modules/**",',
        '      plugins: ["babel-plugin-react-compiler"],',
        "      presets: [",
        '        "@babel/preset-typescript",',
        '        ["@babel/preset-react", { runtime: "automatic" }],',
        "      ],",
        "    }),",
      ]
    : ['    esbuild({ target: "node20", jsx: "automatic" }),'];

  return [
    'import { builtinModules } from "node:module";',
    transformImport,
    'import resolve from "@rollup/plugin-node-resolve";',
    'import commonjs from "@rollup/plugin-commonjs";',
    'import json from "@rollup/plugin-json";',
    'import { streamDeckReact } from "@fcannizzaro/streamdeck-react/rollup";',
    "",
    `const PLUGIN_DIR = "${options.pluginUuid}.sdPlugin";`,
    "const builtins = new Set(builtinModules.flatMap((id) => [id, `node:${id}`]));",
    "",
    "export default {",
    '  input: "src/plugin.ts",',
    "  output: {",
    "    file: `${PLUGIN_DIR}/bin/plugin.mjs`,",
    '    format: "es",',
    "    sourcemap: true,",
    "    inlineDynamicImports: true,",
    "  },",
    "  external: (id) => builtins.has(id),",
    "  plugins: [",
    "    resolve({ preferBuiltins: true }),",
    "    commonjs(),",
    "    json(),",
    ...transformPlugin,
    "    streamDeckReact({",
    "      targets: [",
    renderedTargets,
    "      ],",
    "      manifest: {",
    `        uuid: "${options.pluginUuid}",`,
    `        name: "${options.displayName}",`,
    `        author: "${options.author}",`,
    `        description: "${options.description}",`,
    '        icon: "imgs/plugin-icon",',
    '        version: "0.0.0.1",',
    `        category: "${options.category}",`,
    "      },",
    "    }),",
    "  ],",
    "};",
    "",
  ].join("\n");
}

export function buildViteConfig(
  options: Pick<ScaffoldOptions, "pluginUuid" | "displayName" | "author" | "description" | "category" | "nativeTargets" | "reactCompiler">,
): string {
  const renderedTargets = options.nativeTargets
    .map((target) => {
      const [platform, arch] = target.split("-");
      return `        { platform: "${platform}", arch: "${arch}" },`;
    })
    .join("\n");

  const compilerImport = options.reactCompiler
    ? [
        'import react, { reactCompilerPreset } from "@vitejs/plugin-react";',
        'import babel from "@rolldown/plugin-babel";',
      ]
    : ['import react from "@vitejs/plugin-react";'];

  const compilerPlugin = options.reactCompiler
    ? [
        "    react(),",
        "    // @ts-expect-error — @rolldown/plugin-babel types incorrectly mark inherited babel fields as required",
        "    await babel({",
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
    `      uuid: "${options.pluginUuid}",`,
    "      targets: [",
    renderedTargets,
    "      ],",
    "      manifest: {",
    `        uuid: "${options.pluginUuid}",`,
    `        name: "${options.displayName}",`,
    `        author: "${options.author}",`,
    `        description: "${options.description}",`,
    '        icon: "imgs/plugin-icon",',
    '        version: "0.0.0.1",',
    `        category: "${options.category}",`,
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

function buildPackageJson(
  options: Pick<
    ScaffoldOptions,
    "packageName" | "description" | "nativeTargets" | "reactCompiler" | "bundler" | "adapter" | "streamdeckReactVersion"
  >,
  exampleDependencies: Record<string, string>,
): string {
  const nativeDependencies = Object.fromEntries(
    options.nativeTargets.map((target) => [TARGET_PACKAGE_MAP[target], TAKUMI_VERSION]),
  );

  // The @elgato/streamdeck SDK is only required for the physical device adapter.
  // Custom adapters communicate with the hardware through their own mechanism.
  const adapterDependencies: Record<string, string> =
    options.adapter === "physical" ? { "@elgato/streamdeck": ELGATO_SDK_VERSION } : {};

  const isRolldown = options.bundler === "rolldown";

  const baseDevDeps = isRolldown ? ROLLDOWN_BASE_DEV_DEPENDENCIES : BASE_DEV_DEPENDENCIES;

  const extraDevDeps = isRolldown
    ? options.reactCompiler
      ? ROLLDOWN_COMPILER_DEV_DEPENDENCIES
      : ROLLDOWN_ESBUILD_DEV_DEPENDENCIES
    : options.reactCompiler
      ? COMPILER_DEV_DEPENDENCIES
      : ESBUILD_DEV_DEPENDENCIES;

  const scripts = isRolldown
    ? {
        build: "vite build",
        dev: "vite build --watch",
        "check-types": "tsc --noEmit",
      }
    : {
        build: "rollup -c",
        dev: "rollup -c -w",
        "check-types": "tsc --noEmit",
      };

  const packageJson = {
    name: options.packageName,
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
      ...nativeDependencies,
    }),
    devDependencies: sortObject({
      ...baseDevDeps,
      ...extraDevDeps,
    }),
    description: options.description,
  };

  return `${JSON.stringify(packageJson, null, 2)}\n`;
}

function buildManifest(
  options: Pick<
    ScaffoldOptions,
    "displayName" | "pluginUuid" | "author" | "description" | "category" | "platforms" | "bundler"
  >,
  actions: ManifestActionTemplate[],
): string {
  const manifest = {
    $schema: "https://schemas.elgato.com/streamdeck/plugins/manifest.json",
    Actions: actions.map((action) => {
      const manifestAction: Record<string, unknown> = {
        Icon: `imgs/actions/${action.id}`,
        Name: action.name,
        States: [{ Image: `imgs/actions/${action.id}` }],
        UUID: `${options.pluginUuid}.${action.id}`,
        Controllers: action.controllers,
        Tooltip: action.tooltip,
      };

      if (action.encoder) {
        const triggerDescription: Record<string, string> = {
          Rotate: action.encoder.rotate,
          Push: action.encoder.press,
        };

        if (action.encoder.touch) {
          triggerDescription.Touch = action.encoder.touch;
        }

        manifestAction.Encoder = {
          layout: action.encoder.layout,
          TriggerDescription: triggerDescription,
        };
      }

      return manifestAction;
    }),
    Author: options.author,
    Category: options.category,
    CategoryIcon: "imgs/plugin-icon",
    CodePath: "bin/plugin.mjs",
    Description: options.description,
    Icon: "imgs/plugin-icon",
    Name: options.displayName,
    Nodejs: {
      Version: "24",
    },
    OS: options.platforms.map((platform) => ({
      Platform: platform,
      MinimumVersion: platform === "mac" ? "13" : "10",
    })),
    UUID: options.pluginUuid,
    Version: "0.0.0.1",
    SDKVersion: 2,
    Software: {
      MinimumVersion: "6.9",
    },
  };

  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function buildActionIconFiles(
  pluginDir: string,
  actions: ManifestActionTemplate[],
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
        baseUrl: ".",
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
    `- Native targets: ${options.nativeTargets.join(", ")}`,
    "",
    "## Commands",
    "",
    `- Install dependencies: \`${installCommand}\``,
    `- Build: \`${runPrefix} build\``,
    `- Watch: \`${runPrefix} dev\``,
    `- Type-check: \`${runPrefix} check-types\``,
    "",
    "Install the generated `.sdPlugin` folder in the Stream Deck app after building.",
    "",
  ].join("\n");
}

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

// ── Custom Adapter Scaffolding ────────────────────────────────────────
//
// When adapter is "custom", generate a sample StreamDeckAdapter
// implementation file (src/adapter.ts).  For "physical" no extra files
// are needed because physicalDevice() is imported from the library.

function createAdapterFiles(adapter: Adapter): Record<string, string> {
  if (adapter !== "custom") return {};
  return { "src/adapter.ts": createCustomAdapter() };
}

function createCustomAdapter(): string {
  return [
    'import type { StreamDeckAdapter } from "@fcannizzaro/streamdeck-react";',
    "",
    "// ── Custom Adapter ────────────────────────────────────────────────",
    "//",
    "// Implement the StreamDeckAdapter interface to connect your plugin",
    "// to a custom backend (WebSocket server, test harness, web preview,",
    "// etc.).  Replace the placeholder implementations below with your",
    "// own logic.",
    "",
    "export function myAdapter(): StreamDeckAdapter {",
    "  return {",
    '    pluginUUID: "com.example.custom-adapter",',
    "",
    "    // ── Connection lifecycle ──────────────────────────────────",
    "    async connect() {",
    '      console.log("[adapter] connected");',
    "    },",
    "",
    "    // ── Global settings ───────────────────────────────────────",
    "    async getGlobalSettings() {",
    "      return {};",
    "    },",
    "",
    "    async setGlobalSettings(_settings) {",
    "      // persist global settings",
    "    },",
    "",
    "    onGlobalSettingsChanged(_callback) {",
    "      // subscribe to external global settings changes",
    "    },",
    "",
    "    // ── Action registration ───────────────────────────────────",
    "    registerAction(uuid, callbacks) {",
    "      console.log(`[adapter] registered action: ${uuid}`);",
    "",
    "      // Example: simulate a willAppear event after registration",
    "      // callbacks.onWillAppear({",
    "      //   action: { ... },",
    '      //   payload: { settings: {}, controller: "Keypad", isInMultiAction: false },',
    "      // });",
    "      void callbacks;",
    "    },",
    "",
    "    // ── SDK utilities ─────────────────────────────────────────",
    "    async openUrl(url) {",
    "      console.log(`[adapter] open URL: ${url}`);",
    "    },",
    "",
    "    async switchToProfile(_deviceId, _profile) {",
    "      // switch active Stream Deck profile",
    "    },",
    "",
    "    async sendToPropertyInspector(_payload) {",
    "      // forward payload to Property Inspector",
    "    },",
    "  };",
    "}",
    "",
  ].join("\n");
}

function createPluginEntrypoint(
  actionExports: string[],
  wrapperName?: string,
  adapter?: Adapter,
): string {
  const imports = actionExports
    .map(
      (actionName) =>
        `import { ${actionName} } from "./actions/${stripActionSuffix(actionName)}.tsx";`,
    )
    .join("\n");
  const wrapperImport = wrapperName ? `import { ${wrapperName} } from "./wrapper.tsx";\n` : "";
  const wrapperConfig = wrapperName ? `,\n  wrapper: ${wrapperName}` : "";

  // When using a custom adapter, import from the local adapter file
  // and pass it to createPlugin.  The physical adapter is the default
  // (physicalDevice()) so it needs an explicit import + config entry.
  const useCustomAdapter = adapter === "custom";
  const adapterImport = useCustomAdapter
    ? 'import { myAdapter } from "./adapter.ts";\n'
    : 'import { physicalDevice } from "@fcannizzaro/streamdeck-react";\n';
  const adapterConfig = useCustomAdapter
    ? ",\n  adapter: myAdapter()"
    : ",\n  adapter: physicalDevice()";

  return [
    'import { createPlugin, googleFont } from "@fcannizzaro/streamdeck-react";',
    imports,
    wrapperImport.trimEnd(),
    adapterImport.trimEnd(),
    "",
    'const inter = await googleFont("Inter");',
    "",
    "const plugin = createPlugin({",
    "  fonts: [inter],",
    `  actions: [${actionExports.join(", ")}]${wrapperConfig}${adapterConfig},`,
    "});",
    "",
    "await plugin.connect();",
    "",
  ].join("\n");
}

function stripActionSuffix(actionName: string): string {
  return actionName.replace(/Action$/, "");
}

function createMinimalAction(pluginUuid: string): string {
  return [
    'import { useState } from "react";',
    'import { defineAction, useKeyDown, tw } from "@fcannizzaro/streamdeck-react";',
    "",
    "function StatusKey() {",
    "  const [live, setLive] = useState(false);",
    "",
    "  useKeyDown(() => {",
    "    setLive((value) => !value);",
    "  });",
    "",
    "  return (",
    "    <div",
    "      className={tw(",
    '        "flex h-full w-full flex-col items-center justify-center gap-2",',
    '        live ? "bg-linear-to-br from-[#0f766e] to-[#164e63]" : "bg-linear-to-br from-[#1f2937] to-[#111827]",',
    "      )}",
    "    >",
    '      <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/70">',
    "        Plugin",
    "      </span>",
    '      <span className="text-[24px] font-black text-white">{live ? "Live" : "Standby"}</span>',
    '      <span className="text-[10px] text-white/65">press to toggle</span>',
    "    </div>",
    "  );",
    "}",
    "",
    "export const statusAction = defineAction({",
    `  uuid: "${pluginUuid}.status",`,
    "  key: StatusKey,",
    "  info: {",
    '    name: "Status",',
    '    icon: "imgs/actions/status",',
    "  },",
    "});",
    "",
  ].join("\n");
}

function createCounterAction(pluginUuid: string): string {
  return [
    'import { useState } from "react";',
    'import { defineAction, useKeyDown, useKeyUp, tw } from "@fcannizzaro/streamdeck-react";',
    "",
    "function CounterKey() {",
    "  const [count, setCount] = useState(0);",
    "  const [pressed, setPressed] = useState(false);",
    "",
    "  useKeyDown(() => {",
    "    setCount((value) => value + 1);",
    "    setPressed(true);",
    "  });",
    "",
    "  useKeyUp(() => {",
    "    setPressed(false);",
    "  });",
    "",
    "  return (",
    "    <div",
    "      className={tw(",
    '        "flex h-full w-full flex-col items-center justify-center gap-1",',
    '        pressed ? "bg-linear-to-br from-[#2563eb] to-[#1d4ed8]" : "bg-linear-to-br from-[#0f172a] to-[#1e293b]",',
    "      )}",
    "    >",
    '      <span className="text-[12px] font-semibold uppercase tracking-[0.2em] text-white/70">',
    "        Count",
    "      </span>",
    '      <span className="text-[34px] font-black text-white">{count}</span>',
    "    </div>",
    "  );",
    "}",
    "",
    "export const counterAction = defineAction({",
    `  uuid: "${pluginUuid}.counter",`,
    "  key: CounterKey,",
    "  info: {",
    '    name: "Counter",',
    '    icon: "imgs/actions/counter",',
    "  },",
    "});",
    "",
  ].join("\n");
}

function createTimerAction(pluginUuid: string): string {
  return [
    'import { useCallback, useState } from "react";',
    'import { defineAction, useInterval, useKeyDown, tw } from "@fcannizzaro/streamdeck-react";',
    "",
    "function TimerKey() {",
    "  const [elapsed, setElapsed] = useState(0);",
    "  const [running, setRunning] = useState(false);",
    "",
    "  useKeyDown(() => {",
    "    setRunning((value) => !value);",
    "  });",
    "",
    "  useInterval(() => {",
    "    setElapsed((value) => value + 100);",
    "  }, running ? 100 : null);",
    "",
    "  const formatTime = useCallback((ms: number) => {",
    "    const seconds = Math.floor(ms / 1000);",
    "    const minutes = Math.floor(seconds / 60);",
    "    const displaySeconds = seconds % 60;",
    "    const tenths = Math.floor((ms % 1000) / 100);",
    '    return `${minutes}:${String(displaySeconds).padStart(2, "0")}.${tenths}`;',
    "  }, []);",
    "",
    "  return (",
    "    <div",
    "      className={tw(",
    '        "flex h-full w-full flex-col items-center justify-center gap-1",',
    '        running ? "bg-[#1b5e20]" : "bg-[#212121]",',
    "      )}",
    "    >",
    '      <span className="text-[10px] font-medium text-white/60">{running ? "RUNNING" : "STOPPED"}</span>',
    '      <span className="text-[22px] font-bold text-white">{formatTime(elapsed)}</span>',
    "    </div>",
    "  );",
    "}",
    "",
    "export const timerAction = defineAction({",
    `  uuid: "${pluginUuid}.timer",`,
    "  key: TimerKey,",
    "  info: {",
    '    name: "Timer",',
    '    icon: "imgs/actions/timer",',
    "  },",
    "});",
    "",
  ].join("\n");
}

function createToggleAction(pluginUuid: string): string {
  return [
    'import { defineAction, useKeyDown, useSettings, tw } from "@fcannizzaro/streamdeck-react";',
    "",
    "type ToggleSettings = {",
    '  mode: "off" | "auto" | "on";',
    "};",
    "",
    'const modes = ["off", "auto", "on"] as const;',
    'const modeColors = { off: "#b71c1c", auto: "#f57f17", on: "#1b5e20" };',
    'const modeLabels = { off: "OFF", auto: "AUTO", on: "ON" };',
    "",
    "function ToggleKey() {",
    "  const [settings, setSettings] = useSettings<ToggleSettings>();",
    '  const mode = settings.mode ?? "off";',
    "",
    "  useKeyDown(() => {",
    "    const currentIndex = modes.indexOf(mode);",
    "    const nextMode = modes[(currentIndex + 1) % modes.length] ?? modes[0];",
    "    setSettings({ mode: nextMode });",
    "  });",
    "",
    "  return (",
    "    <div",
    "      className={tw(",
    '        "flex h-full w-full flex-col items-center justify-center gap-1.5",',
    "        `bg-[${modeColors[mode]}]`,",
    "      )}",
    "    >",
    '      <div className="flex flex-row gap-1.5">',
    "        {modes.map((value) => (",
    "          <div",
    "            key={value}",
    "            className={tw(",
    '              "h-2 w-2 rounded-full",',
    '              value === mode ? "bg-white" : "bg-white/30",',
    "            )}",
    "          />",
    "        ))}",
    "      </div>",
    '      <span className="text-[20px] font-bold text-white">{modeLabels[mode]}</span>',
    "    </div>",
    "  );",
    "}",
    "",
    "export const toggleAction = defineAction<ToggleSettings>({",
    `  uuid: "${pluginUuid}.toggle",`,
    "  key: ToggleKey,",
    '  defaultSettings: { mode: "off" },',
    "  info: {",
    '    name: "Toggle",',
    '    icon: "imgs/actions/toggle",',
    "  },",
    "});",
    "",
  ].join("\n");
}

function createVolumeAction(pluginUuid: string): string {
  return [
    'import { useState } from "react";',
    'import { ProgressBar, defineAction, tw, useDialDown, useDialHint, useDialRotate } from "@fcannizzaro/streamdeck-react";',
    "",
    "function VolumeDial() {",
    "  const [volume, setVolume] = useState(50);",
    "  const [muted, setMuted] = useState(false);",
    "",
    "  useDialHint({",
    '    rotate: "Adjust volume",',
    '    press: muted ? "Unmute" : "Mute",',
    "  });",
    "",
    "  useDialRotate(({ ticks }) => {",
    "    if (!muted) {",
    "      setVolume((value) => Math.max(0, Math.min(100, value + ticks * 2)));",
    "    }",
    "  });",
    "",
    "  useDialDown(() => {",
    "    setMuted((value) => !value);",
    "  });",
    "",
    "  return (",
    "    <div",
    "      className={tw(",
    '        "flex h-full w-full flex-col items-center justify-center gap-4 p-2",',
    '        muted ? "bg-[#4a0000]" : "bg-[#1a1a1a]",',
    "      )}",
    "    >",
    '      <span className={tw("text-[24px] font-bold", muted ? "text-[#ff4444]" : "text-white")}>',
    '        {muted ? "MUTE" : `${volume}%`}',
    "      </span>",
    "      <ProgressBar",
    "        value={muted ? 0 : volume}",
    "        height={4}",
    '        color={muted ? "#ff4444" : "#4caf50"}',
    '        background="#333"',
    "        borderRadius={2}",
    "      />",
    "    </div>",
    "  );",
    "}",
    "",
    "export const volumeAction = defineAction({",
    `  uuid: "${pluginUuid}.volume",`,
    "  dial: VolumeDial,",
    "  info: {",
    '    name: "Volume",',
    '    icon: "imgs/actions/volume",',
    "    encoder: {",
    '      layout: "$A0",',
    "      triggerDescription: {",
    '        rotate: "Adjust volume",',
    '        push: "Mute / Unmute",',
    "      },",
    "    },",
    "  },",
    "});",
    "",
  ].join("\n");
}

function createEqualizerAction(pluginUuid: string): string {
  return [
    'import { useState, useRef } from "react";',
    "import {",
    "  defineAction,",
    "  useTouchStrip,",
    "  useTouchStripDialRotate,",
    "  useTouchStripDialDown,",
    "  useTouchStripTap,",
    "  useTick,",
    '} from "@fcannizzaro/streamdeck-react";',
    "",
    "const BAR_COUNT = 32;",
    "const BAR_GAP = 3;",
    "const MIN_SPEED = 0.2;",
    "const MAX_SPEED = 5;",
    "const DEFAULT_SPEED = 1;",
    "const DEFAULT_AMPLITUDE = 0.8;",
    "",
    "const THEMES = [",
    '  { from: "#667eea", to: "#764ba2" },',
    '  { from: "#00ff88", to: "#00aa55" },',
    '  { from: "#ff3366", to: "#ff9966" },',
    '  { from: "#00bcd4", to: "#2196f3" },',
    '  { from: "#ffd700", to: "#ff8c00" },',
    "] as const;",
    "",
    "function lerpColor(a: string, b: string, t: number): string {",
    "  const parseHex = (hex: string) => {",
    '    const h = hex.replace("#", "");',
    "    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];",
    "  };",
    "  const [ar, ag, ab] = parseHex(a);",
    "  const [br, bg, bb] = parseHex(b);",
    "  const r = Math.round(ar! + (br! - ar!) * t);",
    "  const g = Math.round(ag! + (bg! - ag!) * t);",
    "  const blue = Math.round(ab! + (bb! - ab!) * t);",
    "  return `rgb(${r},${g},${blue})`;",
    "}",
    "",
    "function EqualizerTouchStrip() {",
    "  const { width, height, segmentWidth } = useTouchStrip();",
    "",
    "  const [speed, setSpeed] = useState(DEFAULT_SPEED);",
    "  const [amplitude, setAmplitude] = useState(DEFAULT_AMPLITUDE);",
    "  const [paused, setPaused] = useState(false);",
    "  const [themeIndex, setThemeIndex] = useState(0);",
    "  const timeRef = useRef(0);",
    "  const [time, setTime] = useState(0);",
    "",
    "  const theme = THEMES[themeIndex % THEMES.length]!;",
    "  const barWidth = (width - BAR_GAP * (BAR_COUNT + 1)) / BAR_COUNT;",
    "",
    "  useTick((delta) => {",
    "    if (paused) return;",
    "    timeRef.current += delta * 0.001 * speed;",
    "    setTime(timeRef.current);",
    "  });",
    "",
    "  useTouchStripDialRotate(({ column, ticks }) => {",
    "    if (column === 0) {",
    "      setSpeed((s) => Math.max(MIN_SPEED, Math.min(MAX_SPEED, s + ticks * 0.2)));",
    "    } else if (column === 1) {",
    "      setAmplitude((a) => Math.max(0.1, Math.min(1, a + ticks * 0.05)));",
    "    }",
    "  });",
    "",
    "  useTouchStripDialDown(({ column }) => {",
    "    if (column === 2) {",
    "      setPaused((p) => !p);",
    "    } else if (column === 3) {",
    "      setSpeed(DEFAULT_SPEED);",
    "      setAmplitude(DEFAULT_AMPLITUDE);",
    "      setPaused(false);",
    "      timeRef.current = 0;",
    "      setTime(0);",
    "    }",
    "  });",
    "",
    "  useTouchStripTap(() => {",
    "    setThemeIndex((i) => (i + 1) % THEMES.length);",
    "  });",
    "",
    "  return (",
    "    <div",
    "      style={{",
    "        width,",
    "        height,",
    '        position: "relative",',
    '        overflow: "hidden",',
    '        background: "#0d1117",',
    "      }}",
    "    >",
    "      {Array.from({ length: BAR_COUNT }, (_, i) => {",
    "        const phase = (i / BAR_COUNT) * Math.PI * 4;",
    "        const wave1 = Math.sin(time * 2 + phase) * 0.5 + 0.5;",
    "        const wave2 = Math.sin(time * 3.7 + phase * 0.6) * 0.3 + 0.3;",
    "        const value = Math.min(1, (wave1 + wave2) * amplitude);",
    "        const barHeight = Math.max(2, value * (height - 10));",
    "        const x = BAR_GAP + i * (barWidth + BAR_GAP);",
    "        const color = lerpColor(theme.from, theme.to, i / BAR_COUNT);",
    "",
    "        return (",
    "          <div",
    "            key={i}",
    "            style={{",
    '              position: "absolute",',
    "              left: x,",
    "              bottom: 5,",
    "              width: barWidth,",
    "              height: barHeight,",
    "              background: color,",
    "              borderRadius: 2,",
    "            }}",
    "          />",
    "        );",
    "      })}",
    "      {[0, 1, 2, 3].map((col) => (",
    "        <div",
    "          key={`label-${col}`}",
    "          style={{",
    '            position: "absolute",',
    "            left: col * segmentWidth,",
    "            top: 4,",
    "            width: segmentWidth,",
    '            display: "flex",',
    '            alignItems: "center",',
    '            justifyContent: "center",',
    "          }}",
    "        >",
    "          <span",
    "            style={{",
    '              color: "white",',
    "              fontSize: 10,",
    '              fontFamily: "Inter",',
    "              opacity: 0.4,",
    "            }}",
    "          >",
    "            {col === 0",
    "              ? `SPD ${speed.toFixed(1)}x`",
    "              : col === 1",
    "                ? `AMP ${Math.round(amplitude * 100)}%`",
    "                : col === 2",
    "                  ? paused",
    '                    ? "RESUME"',
    '                    : "PAUSE"',
    '                  : "RESET"}',
    "          </span>",
    "        </div>",
    "      ))}",
    "    </div>",
    "  );",
    "}",
    "",
    "export const equalizerAction = defineAction({",
    `  uuid: "${pluginUuid}.equalizer",`,
    "  touchStrip: EqualizerTouchStrip,",
    "  info: {",
    '    name: "Equalizer",',
    '    icon: "imgs/actions/equalizer",',
    "    encoder: {",
    '      layout: "layouts/touchstrip.json",',
    "      triggerDescription: {",
    '        rotate: "Adjust speed / amplitude",',
    '        push: "Pause / Reset",',
    '        touch: "Change color theme",',
    "      },",
    "    },",
    "  },",
    "});",
    "",
  ].join("\n");
}

function createTouchStripLayout(): string {
  return `${JSON.stringify(
    {
      id: "com.streamdeck-react.touchstrip-layout",
      items: [
        {
          key: "canvas",
          type: "pixmap",
          rect: [0, 0, 200, 100],
        },
      ],
    },
    null,
    2,
  )}\n`;
}

function createZustandStore(): string {
  return [
    'import { create } from "zustand";',
    "",
    "type CounterStore = {",
    "  count: number;",
    "  increment: () => void;",
    "  reset: () => void;",
    "};",
    "",
    "export const useCounterStore = create<CounterStore>((set) => ({",
    "  count: 0,",
    "  increment: () => {",
    "    set((state) => ({ count: state.count + 1 }));",
    "  },",
    "  reset: () => {",
    "    set({ count: 0 });",
    "  },",
    "}));",
    "",
  ].join("\n");
}

function createZustandDisplayAction(pluginUuid: string): string {
  return [
    'import { defineAction, tw } from "@fcannizzaro/streamdeck-react";',
    'import { useCounterStore } from "../store.ts";',
    "",
    "function SharedDisplayKey() {",
    "  const count = useCounterStore((state) => state.count);",
    "",
    "  return (",
    "    <div",
    "      className={tw(",
    '        "flex h-full w-full flex-col items-center justify-center gap-1",',
    '        "bg-linear-to-br from-[#12343b] via-[#1f7a8c] to-[#bfdbf7]",',
    "      )}",
    "    >",
    '      <span className="text-[11px] font-medium uppercase tracking-[0.24em] text-white/70">',
    "        Shared",
    "      </span>",
    '      <span className="text-[34px] font-bold text-white">{count}</span>',
    '      <span className="text-[10px] text-white/75">updates everywhere</span>',
    "    </div>",
    "  );",
    "}",
    "",
    "export const displayAction = defineAction({",
    `  uuid: "${pluginUuid}.display",`,
    "  key: SharedDisplayKey,",
    "  info: {",
    '    name: "Shared Display",',
    '    icon: "imgs/actions/display",',
    "  },",
    "});",
    "",
  ].join("\n");
}

function createZustandIncrementAction(pluginUuid: string): string {
  return [
    'import { defineAction, tw, useKeyDown } from "@fcannizzaro/streamdeck-react";',
    'import { useCounterStore } from "../store.ts";',
    "",
    "function IncrementKey() {",
    "  const count = useCounterStore((state) => state.count);",
    "  const increment = useCounterStore((state) => state.increment);",
    "",
    "  useKeyDown(() => {",
    "    increment();",
    "  });",
    "",
    "  return (",
    "    <div",
    "      className={tw(",
    '        "flex h-full w-full flex-col items-center justify-center gap-1",',
    '        "bg-linear-to-br from-[#ee964b] to-[#f95738]",',
    "      )}",
    "    >",
    '      <span className="text-[12px] font-semibold uppercase tracking-[0.22em] text-white/75">Add</span>',
    '      <span className="text-[30px] font-black text-white">+1</span>',
    '      <span className="text-[11px] text-white/80">count {count}</span>',
    "    </div>",
    "  );",
    "}",
    "",
    "export const incrementAction = defineAction({",
    `  uuid: "${pluginUuid}.increment",`,
    "  key: IncrementKey,",
    "  info: {",
    '    name: "Increment",',
    '    icon: "imgs/actions/increment",',
    "  },",
    "});",
    "",
  ].join("\n");
}

function createZustandResetAction(pluginUuid: string): string {
  return [
    'import { defineAction, tw, useKeyDown } from "@fcannizzaro/streamdeck-react";',
    'import { useCounterStore } from "../store.ts";',
    "",
    "function ResetKey() {",
    "  const reset = useCounterStore((state) => state.reset);",
    "",
    "  useKeyDown(() => {",
    "    reset();",
    "  });",
    "",
    "  return (",
    "    <div",
    "      className={tw(",
    '        "flex h-full w-full flex-col items-center justify-center gap-1",',
    '        "bg-[#2f2d2e]",',
    "      )}",
    "    >",
    '      <span className="text-[12px] font-semibold uppercase tracking-[0.22em] text-white/60">Sync</span>',
    '      <span className="text-[24px] font-bold text-[#f4f1de]">Reset</span>',
    '      <span className="text-[10px] text-white/65">shared store</span>',
    "    </div>",
    "  );",
    "}",
    "",
    "export const resetAction = defineAction({",
    `  uuid: "${pluginUuid}.reset",`,
    "  key: ResetKey,",
    "  info: {",
    '    name: "Reset",',
    '    icon: "imgs/actions/reset",',
    "  },",
    "});",
    "",
  ].join("\n");
}

function createJotaiStore(): string {
  return [
    'import { atom, createStore } from "jotai";',
    "",
    "export const store = createStore();",
    "",
    "export const countAtom = atom(0);",
    "",
    "export const incrementAtom = atom(null, (get, set) => {",
    "  set(countAtom, get(countAtom) + 1);",
    "});",
    "",
    "export const resetAtom = atom(null, (_get, set) => {",
    "  set(countAtom, 0);",
    "});",
    "",
  ].join("\n");
}

function createJotaiWrapper(): string {
  return [
    'import type { ReactNode } from "react";',
    'import { Provider } from "jotai";',
    'import { store } from "./store.ts";',
    "",
    "type JotaiWrapperProps = {",
    "  children?: ReactNode;",
    "};",
    "",
    "export function JotaiWrapper({ children }: JotaiWrapperProps) {",
    "  return <Provider store={store}>{children}</Provider>;",
    "}",
    "",
  ].join("\n");
}

function createJotaiDisplayAction(pluginUuid: string): string {
  return [
    'import { useAtomValue } from "jotai";',
    'import { defineAction, tw } from "@fcannizzaro/streamdeck-react";',
    'import { countAtom } from "../store.ts";',
    "",
    "function AtomDisplayKey() {",
    "  const count = useAtomValue(countAtom);",
    "",
    "  return (",
    "    <div",
    "      className={tw(",
    '        "flex h-full w-full flex-col items-center justify-center gap-1",',
    '        "bg-gradient-to-br from-[#0b132b] via-[#1c2541] to-[#3a506b]",',
    "      )}",
    "    >",
    '      <span className="text-[11px] font-medium uppercase tracking-[0.24em] text-[#9fb3c8]">Atom</span>',
    '      <span className="text-[34px] font-bold text-white">{count}</span>',
    '      <span className="text-[10px] text-white/65">shared by wrapper</span>',
    "    </div>",
    "  );",
    "}",
    "",
    "export const displayAction = defineAction({",
    `  uuid: "${pluginUuid}.display",`,
    "  key: AtomDisplayKey,",
    "  info: {",
    '    name: "Atom Display",',
    '    icon: "imgs/actions/display",',
    "  },",
    "});",
    "",
  ].join("\n");
}

function createJotaiIncrementAction(pluginUuid: string): string {
  return [
    'import { useSetAtom } from "jotai";',
    'import { defineAction, tw, useKeyDown } from "@fcannizzaro/streamdeck-react";',
    'import { incrementAtom } from "../store.ts";',
    "",
    "function IncrementAtomKey() {",
    "  const increment = useSetAtom(incrementAtom);",
    "",
    "  useKeyDown(() => {",
    "    increment();",
    "  });",
    "",
    "  return (",
    "    <div",
    "      className={tw(",
    '        "flex h-full w-full flex-col items-center justify-center gap-1",',
    '        "bg-gradient-to-br from-[#5bc0be] to-[#6fffe9]",',
    "      )}",
    "    >",
    '      <span className="text-[12px] font-semibold uppercase tracking-[0.22em] text-[#0b132b]/70">',
    "        Pulse",
    "      </span>",
    '      <span className="text-[30px] font-black text-[#0b132b]">+1</span>',
    '      <span className="text-[10px] text-[#0b132b]/70">shared atom write</span>',
    "    </div>",
    "  );",
    "}",
    "",
    "export const incrementAction = defineAction({",
    `  uuid: "${pluginUuid}.increment",`,
    "  key: IncrementAtomKey,",
    "  info: {",
    '    name: "Increment Atom",',
    '    icon: "imgs/actions/increment",',
    "  },",
    "});",
    "",
  ].join("\n");
}

function createJotaiResetAction(pluginUuid: string): string {
  return [
    'import { useSetAtom } from "jotai";',
    'import { defineAction, tw, useKeyDown } from "@fcannizzaro/streamdeck-react";',
    'import { resetAtom } from "../store.ts";',
    "",
    "function ResetAtomKey() {",
    "  const reset = useSetAtom(resetAtom);",
    "",
    "  useKeyDown(() => {",
    "    reset();",
    "  });",
    "",
    "  return (",
    "    <div",
    "      className={tw(",
    '        "flex h-full w-full flex-col items-center justify-center gap-1",',
    '        "bg-[#1b1b1e]",',
    "      )}",
    "    >",
    '      <span className="text-[12px] font-semibold uppercase tracking-[0.22em] text-white/55">Store</span>',
    '      <span className="text-[24px] font-bold text-[#6fffe9]">Reset</span>',
    '      <span className="text-[10px] text-white/60">plugin wrapper</span>',
    "    </div>",
    "  );",
    "}",
    "",
    "export const resetAction = defineAction({",
    `  uuid: "${pluginUuid}.reset",`,
    "  key: ResetAtomKey,",
    "  info: {",
    '    name: "Reset Atom",',
    '    icon: "imgs/actions/reset",',
    "  },",
    "});",
    "",
  ].join("\n");
}

function createQueryWrapper(): string {
  return [
    'import type { ReactNode } from "react";',
    'import { QueryClient, QueryClientProvider } from "@tanstack/react-query";',
    "",
    "const queryClient = new QueryClient({",
    "  defaultOptions: {",
    "    queries: {",
    "      retry: 2,",
    "      staleTime: Infinity,",
    "    },",
    "  },",
    "});",
    "",
    "type QueryWrapperProps = {",
    "  children?: ReactNode;",
    "};",
    "",
    "export function QueryWrapper({ children }: QueryWrapperProps) {",
    "  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;",
    "}",
    "",
  ].join("\n");
}

function createPokemonAction(pluginUuid: string): string {
  return [
    'import { useState } from "react";',
    'import { useQuery } from "@tanstack/react-query";',
    'import { Image, defineAction, tw, useKeyDown } from "@fcannizzaro/streamdeck-react";',
    "",
    "const MAX_POKEMON_ID = 1025;",
    "",
    "function randomPokemonId(): number {",
    "  return Math.floor(Math.random() * MAX_POKEMON_ID) + 1;",
    "}",
    "",
    "function capitalize(value: string): string {",
    "  return value.charAt(0).toUpperCase() + value.slice(1);",
    "}",
    "",
    "function padId(id: number): string {",
    '  return `#${String(id).padStart(3, "0")}`;',
    "}",
    "",
    "async function bufferToDataUri(response: Response, mime: string): Promise<string> {",
    "  const arrayBuffer = await response.arrayBuffer();",
    '  const base64 = Buffer.from(arrayBuffer).toString("base64");',
    "  return `data:${mime};base64,${base64}`;",
    "}",
    "",
    "type PokemonData = {",
    "  id: number;",
    "  name: string;",
    "  spriteDataUri: string;",
    "};",
    "",
    "async function fetchPokemon(id: number, signal: AbortSignal): Promise<PokemonData> {",
    "  const response = await fetch(`https://pokeapi.co/api/v2/pokemon/${id}`, { signal });",
    "",
    "  if (!response.ok) {",
    "    throw new Error(`PokeAPI returned ${response.status}`);",
    "  }",
    "",
    "  const payload = (await response.json()) as {",
    "    name: string;",
    "    sprites: {",
    "      front_default: string | null;",
    '      other?: { "official-artwork"?: { front_default: string | null } };',
    "    };",
    "  };",
    "",
    "  const spriteUrl =",
    "    payload.sprites.front_default ??",
    '    payload.sprites.other?.["official-artwork"]?.front_default ??',
    "    null;",
    "",
    "  if (!spriteUrl) {",
    "    throw new Error(`No sprite available for Pokemon ${id}`);",
    "  }",
    "",
    "  const spriteResponse = await fetch(spriteUrl, { signal });",
    "",
    "  if (!spriteResponse.ok) {",
    "    throw new Error(`Sprite fetch returned ${spriteResponse.status}`);",
    "  }",
    "",
    '  const spriteDataUri = await bufferToDataUri(spriteResponse, "image/png");',
    "  return { id, name: payload.name, spriteDataUri };",
    "}",
    "",
    "function PokemonKey() {",
    "  const [pokemonId, setPokemonId] = useState(() => randomPokemonId());",
    "",
    "  useKeyDown(() => {",
    "    setPokemonId(randomPokemonId());",
    "  });",
    "",
    "  const { data, isLoading, isError } = useQuery({",
    '    queryKey: ["pokemon", pokemonId],',
    "    queryFn: ({ signal }) => fetchPokemon(pokemonId, signal),",
    "  });",
    "",
    "  if (isLoading) {",
    "    return (",
    "      <div",
    "        className={tw(",
    '          "flex h-full w-full flex-col items-center justify-center",',
    '          "bg-gradient-to-br from-[#1a1a2e] to-[#16213e]",',
    "        )}",
    "      >",
    '        <span className="text-[14px] font-bold text-white/80">Loading...</span>',
    "      </div>",
    "    );",
    "  }",
    "",
    "  if (isError || !data) {",
    "    return (",
    "      <div",
    "        className={tw(",
    '          "flex h-full w-full flex-col items-center justify-center gap-1",',
    '          "bg-gradient-to-br from-[#4a0000] to-[#1a0000]",',
    "        )}",
    "      >",
    '        <span className="text-[12px] font-bold text-[#ff6b6b]">Error</span>',
    '        <span className="text-[10px] text-white/50">{padId(pokemonId)}</span>',
    "      </div>",
    "    );",
    "  }",
    "",
    "  return (",
    "    <div",
    "      className={tw(",
    '        "relative h-full w-full overflow-hidden",',
    '        "bg-gradient-to-br from-[#0f3460] to-[#533483]",',
    "      )}",
    "    >",
    '      <div className={tw("absolute inset-0 flex items-center justify-center")}>',
    '        <Image src={data.spriteDataUri} width={144} height={144} fit="contain" />',
    "      </div>",
    '      <div className={tw("relative z-10 flex h-full w-full items-end justify-center px-2 pb-2")}>',
    "        <span",
    '          className="text-[16px] font-bold text-white"',
    '          style={{ textShadow: "0 3px 8px rgba(0, 0, 0, 0.9)" }}',
    "        >",
    "          {capitalize(data.name)}",
    "        </span>",
    "      </div>",
    "    </div>",
    "  );",
    "}",
    "",
    "export const pokemonAction = defineAction({",
    `  uuid: "${pluginUuid}.pokemon",`,
    "  key: PokemonKey,",
    "  info: {",
    '    name: "Random Pokemon",',
    '    icon: "imgs/actions/pokemon",',
    "  },",
    "});",
    "",
  ].join("\n");
}

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
