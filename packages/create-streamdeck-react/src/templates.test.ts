import { test, expect } from "bun:test";
import { buildProjectFiles, buildViteConfig, type ScaffoldOptions } from "./templates.js";

const baseOptions: ScaffoldOptions = {
  packageName: "demo-plugin",
  displayName: "Demo Plugin",
  pluginUuid: "com.example.demo-plugin",
  author: "Test Author",
  description: "A demo plugin.",
  category: "Demo Plugin",
  packageManager: "npm",
  example: "counter",
  platforms: ["mac", "windows"],
  nativeTargets: ["darwin-arm64", "win32-x64"],
  reactCompiler: false,
  adapter: "physical",
  streamdeckReactVersion: "^1.0.0",
};

test("project package.json includes selected native target dependencies", () => {
  const files = buildProjectFiles(baseOptions);
  const packageJson = JSON.parse(files["package.json"] ?? "{}");

  expect(packageJson.dependencies["@takumi-rs/core-darwin-arm64"]).toBe("^0.71.7");
  expect(packageJson.dependencies["@takumi-rs/core-win32-x64-msvc"]).toBe("^0.71.7");
});

test("manifest matches example actions and supported platforms", () => {
  const files = buildProjectFiles(baseOptions);
  const manifest = JSON.parse(files["com.example.demo-plugin.sdPlugin/manifest.json"] ?? "{}");

  expect(manifest.Actions).toHaveLength(5);
  expect(manifest.OS.map((entry: { Platform: string }) => entry.Platform)).toEqual([
    "mac",
    "windows",
  ]);
});

test("generates vite.config.ts with streamDeckReact plugin", () => {
  const files = buildProjectFiles(baseOptions);

  expect(files["vite.config.ts"]).toBeDefined();

  const packageJson = JSON.parse(files["package.json"] ?? "{}");
  expect(packageJson.scripts.build).toBe("vite build");
  expect(packageJson.devDependencies["vite"]).toBeDefined();

  const manifest = JSON.parse(files["com.example.demo-plugin.sdPlugin/manifest.json"] ?? "{}");
  expect(manifest.Nodejs.Version).toBe("24");
});

test("vite config renders streamDeckReact with targets", () => {
  const config = buildViteConfig(baseOptions);

  expect(config).toContain("streamDeckReact({");
  expect(config).toContain('{ platform: "darwin", arch: "arm64" }');
  expect(config).toContain('{ platform: "win32", arch: "x64" }');
  expect(config).toContain("esmExternalRequirePlugin");
  expect(config).toContain('conditions: ["node"]');
});

test("react compiler includes babel plugin", () => {
  const options: ScaffoldOptions = { ...baseOptions, reactCompiler: true };
  const files = buildProjectFiles(options);
  const packageJson = JSON.parse(files["package.json"] ?? "{}");

  expect(packageJson.devDependencies["@rolldown/plugin-babel"]).toBeDefined();
  expect(packageJson.devDependencies["babel-plugin-react-compiler"]).toBeDefined();

  const config = files["vite.config.ts"] ?? "";
  expect(config).toContain("reactCompilerPreset");
  expect(config).toContain("await babel(");
});
