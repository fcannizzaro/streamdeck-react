import { test, expect } from "bun:test";
import { buildProjectFiles, buildViteConfig, type ScaffoldOptions } from "./templates.js";

// ── Lazy mode (default) ─────────────────────────────────────────────

const lazyOptions: ScaffoldOptions = {
  packageName: "demo-plugin",
  displayName: "Demo Plugin",
  pluginUuid: "com.example.demo-plugin",
  author: "Test Author",
  description: "A demo plugin.",
  category: "Demo Plugin",
  packageManager: "npm",
  example: "basic",
  platforms: ["mac", "windows"],
  nativeBindings: "lazy",
  reactCompiler: false,
  adapter: "physical",
  streamdeckReactVersion: "^1.0.0",
};

test("lazy mode: package.json omits native target dependencies", () => {
  const files = buildProjectFiles(lazyOptions);
  const packageJson = JSON.parse(files["package.json"] ?? "{}");

  expect(packageJson.dependencies["@takumi-rs/core-darwin-arm64"]).toBeUndefined();
  expect(packageJson.dependencies["@takumi-rs/core-win32-x64-msvc"]).toBeUndefined();
});

test("lazy mode: vite config omits targets and nativeBindings", () => {
  const config = buildViteConfig(lazyOptions);

  // No top-level uuid — auto-derived from manifest.uuid by the plugin
  expect(config).toContain("streamDeckReact({\n      manifest:");
  expect(config).not.toContain("targets:");
  expect(config).not.toContain("nativeBindings:");
  expect(config).toContain("esmExternalRequirePlugin");
  expect(config).toContain('conditions: ["node"]');
  expect(config).toContain("sdkVersion: 3,");
  expect(config).toContain('nodejs: { version: "24" },');
});

test("lazy mode: manifest.json is NOT generated (auto-generated at build time)", () => {
  const files = buildProjectFiles(lazyOptions);

  expect(files["com.example.demo-plugin.sdPlugin/manifest.json"]).toBeUndefined();
});

test("lazy mode: generates vite.config.ts with streamDeckReact plugin", () => {
  const files = buildProjectFiles(lazyOptions);

  expect(files["vite.config.ts"]).toBeDefined();

  const packageJson = JSON.parse(files["package.json"] ?? "{}");
  expect(packageJson.scripts.build).toBe("vite build");
  expect(packageJson.devDependencies["vite"]).toBeDefined();
});

// ── Copy mode ───────────────────────────────────────────────────────

const copyOptions: ScaffoldOptions = {
  ...lazyOptions,
  nativeBindings: "copy",
};

test("copy mode: package.json omits native target dependencies", () => {
  const files = buildProjectFiles(copyOptions);
  const packageJson = JSON.parse(files["package.json"] ?? "{}");

  expect(packageJson.dependencies["@takumi-rs/core-darwin-arm64"]).toBeUndefined();
  expect(packageJson.dependencies["@takumi-rs/core-win32-x64-msvc"]).toBeUndefined();
});

test("copy mode: vite config renders nativeBindings", () => {
  const config = buildViteConfig(copyOptions);

  // No top-level uuid — auto-derived from manifest.uuid by the plugin
  expect(config).toContain('streamDeckReact({\n      nativeBindings: "copy",\n      manifest:');
  expect(config).not.toContain("targets:");
  expect(config).toContain("esmExternalRequirePlugin");
  expect(config).toContain('conditions: ["node"]');
  expect(config).toContain("sdkVersion: 3,");
  expect(config).toContain('nodejs: { version: "24" },');
});

// ── React Compiler ──────────────────────────────────────────────────

test("react compiler includes babel plugin", () => {
  const options: ScaffoldOptions = { ...lazyOptions, reactCompiler: true };
  const files = buildProjectFiles(options);
  const packageJson = JSON.parse(files["package.json"] ?? "{}");

  expect(packageJson.devDependencies["@rolldown/plugin-babel"]).toBeDefined();
  expect(packageJson.devDependencies["babel-plugin-react-compiler"]).toBeDefined();

  const config = files["vite.config.ts"] ?? "";
  expect(config).toContain("reactCompilerPreset");
  expect(config).toContain("babel(");
  expect(config).not.toContain("await babel(");
});
