import { test, expect } from "bun:test";
import { buildProjectFiles, buildRollupConfig, type ScaffoldOptions } from "./templates.js";

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
