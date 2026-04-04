// ── Native Versions Manifest ────────────────────────────────────────
//
// Tracks the installed versions of lazily-downloaded .node files.
// The manifest is a JSON file written to the bundle output directory
// alongside the cached .node binaries.
//
// Purpose: cache invalidation on dependency upgrades.
//
// When a native module version changes between builds (e.g.
// @takumi-rs/core 0.73.1 → 0.74.0), the baked-in VERSION constant
// in the lazy loader virtual module will differ from the version
// recorded in the manifest.  The loader detects this mismatch and
// re-downloads the .node binary instead of loading the stale cached
// file.
//
// Without this mechanism, the existsSync() check in the lazy loader
// would succeed on the stale binary and load it — potentially causing
// ABI incompatibilities or missing features from the newer version.
//
//   Build N (v0.73.1):
//     lazy loader bakes VERSION = "0.73.1"
//     runtime: downloads core.darwin-arm64.node
//     writes manifest: { "core.darwin-arm64.node": "0.73.1" }
//
//   Build N+1 (v0.74.0):
//     lazy loader bakes VERSION = "0.74.0"
//     runtime: reads manifest → "0.73.1" ≠ "0.74.0" → re-downloads
//     updates manifest: { "core.darwin-arm64.node": "0.74.0" }
//
// File layout (.native-versions.json):
//
//   {
//     "core.darwin-arm64.node": "0.73.1",
//     "native.win32-x64-msvc.node": "1.0.0"
//   }
//
// Multiple native modules can coexist in the same manifest.  Each
// lazy loader only reads/writes its own key, so concurrent top-level
// module evaluation is safe (Node.js evaluates ESM sequentially).

/**
 * Filename for the version manifest, written alongside lazy-loaded
 * `.node` files in the bundle output directory.
 *
 * The lazy loader reads this file at runtime to determine whether a
 * cached `.node` binary matches the expected version.  When a
 * mismatch is detected (e.g. after a dependency upgrade), the binary
 * is re-downloaded from npm and the manifest is updated.
 *
 * @example
 * ```ts
 * import { NATIVE_VERSIONS_FILENAME } from "@fcannizzaro/streamdeck-react/vite";
 *
 * // Read the manifest to inspect cached binding versions
 * const manifest = JSON.parse(
 *   readFileSync(join(outDir, NATIVE_VERSIONS_FILENAME), "utf8"),
 * );
 * ```
 */
export const NATIVE_VERSIONS_FILENAME = ".native-versions.json";

/**
 * Shape of the version manifest file written alongside lazy-loaded
 * `.node` binaries.
 *
 * Keys are `.node` filenames (e.g. `"core.darwin-arm64.node"`).
 * Values are the npm package version strings they were downloaded
 * from (e.g. `"0.73.1"`).
 *
 * The manifest is read/written atomically by the lazy loader at
 * runtime — each native module only updates its own key, so
 * concurrent access from multiple native modules is safe.
 */
export interface NativeVersionsManifest {
  [nodeFilename: string]: string;
}
