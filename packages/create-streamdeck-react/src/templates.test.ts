import { test, expect } from "bun:test";
import { buildProjectFiles, buildRollupConfig, buildViteConfig, type ScaffoldOptions } from "./templates.js";

const baseOptions: ScaffoldOptions = {
  packageName: "demo-plugin",
  displayName: "Demo Plugin",
  pluginUuid: "com.example.demo-plugin",
  author: "Test Author",
  description: "A demo plugin.",
  category: "Demo Plugin",
  packageManager: "npm",
  bundler: "rollup",
  example: "counter",
  platforms: ["mac", "windows"],
  nativeTargets: ["darwin-arm64", "win32-x64"],
  reactCompiler: false,
};

test("project package.json includes selected native target dependencies", () => {
  const files = buildProjectFiles(baseOptions);
  const packageJson = JSON.parse(files["package.json"] ?? "{}");

  expect(packageJson.dependencies["@takumi-rs/core-darwin-arm64"]).toBe("^0.70.4");
  expect(packageJson.dependencies["@takumi-rs/core-win32-x64-msvc"]).toBe("^0.70.4");
});

test("manifest matches example actions and supported platforms", () => {
  const files = buildProjectFiles(baseOptions);
  const manifest = JSON.parse(files["com.example.demo-plugin.sdPlugin/manifest.json"] ?? "{}");

  expect(manifest.Actions).toHaveLength(4);
  expect(manifest.OS.map((entry: { Platform: string }) => entry.Platform)).toEqual(["mac", "windows"]);
});

test("rollup config renders explicit nativeAddon targets", () => {
  const config = buildRollupConfig(baseOptions);

  expect(config).toContain('nativeAddon({');
  expect(config).toContain('{ platform: "darwin", arch: "arm64" }');
  expect(config).toContain('{ platform: "win32", arch: "x64" }');
  expect(config).not.toContain("resolveLibraryPaths");
});

test("rollup bundler generates rollup.config.mjs", () => {
  const files = buildProjectFiles(baseOptions);

  expect(files["rollup.config.mjs"]).toBeDefined();
  expect(files["vite.config.ts"]).toBeUndefined();

  const packageJson = JSON.parse(files["package.json"] ?? "{}");
  expect(packageJson.scripts.build).toBe("rollup -c");
  expect(packageJson.devDependencies["rollup"]).toBeDefined();

  const manifest = JSON.parse(files["com.example.demo-plugin.sdPlugin/manifest.json"] ?? "{}");
  expect(manifest.Nodejs.Version).toBe("24");
});

test("rolldown bundler generates vite.config.ts", () => {
  const options: ScaffoldOptions = { ...baseOptions, bundler: "rolldown" };
  const files = buildProjectFiles(options);

  expect(files["vite.config.ts"]).toBeDefined();
  expect(files["rollup.config.mjs"]).toBeUndefined();

  const packageJson = JSON.parse(files["package.json"] ?? "{}");
  expect(packageJson.scripts.build).toBe("vite build");
  expect(packageJson.devDependencies["vite"]).toBeDefined();
  expect(packageJson.devDependencies["rollup"]).toBeUndefined();

  const manifest = JSON.parse(files["com.example.demo-plugin.sdPlugin/manifest.json"] ?? "{}");
  expect(manifest.Nodejs.Version).toBe("24");
});

test("vite config renders streamDeckReact with targets", () => {
  const config = buildViteConfig(baseOptions);

  expect(config).toContain('streamDeckReact({');
  expect(config).toContain('{ platform: "darwin", arch: "arm64" }');
  expect(config).toContain('{ platform: "win32", arch: "x64" }');
  expect(config).toContain('esmExternalRequirePlugin');
  expect(config).toContain('conditions: ["node"]');
});

test("rolldown with react compiler includes babel plugin", () => {
  const options: ScaffoldOptions = { ...baseOptions, bundler: "rolldown", reactCompiler: true };
  const files = buildProjectFiles(options);
  const packageJson = JSON.parse(files["package.json"] ?? "{}");

  expect(packageJson.devDependencies["@rolldown/plugin-babel"]).toBeDefined();
  expect(packageJson.devDependencies["babel-plugin-react-compiler"]).toBeDefined();

  const config = files["vite.config.ts"] ?? "";
  expect(config).toContain("reactCompilerPreset");
  expect(config).toContain("await babel(");
});
