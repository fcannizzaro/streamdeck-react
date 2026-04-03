import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

// ── Build-time Font Inlining ────────────────────────────────────────
//
// Converts font file imports (.ttf, .otf, .woff, .woff2) into
// synthetic ES modules at build time:
//
//   import font from "./Inter-Regular.ttf";
//       ↓ becomes at runtime ↓
//   const font = Buffer.from("AAEAAAA...", "base64");
//
// Why: Stream Deck plugins run in a sandboxed Node.js environment
// where the working directory and node_modules layout are controlled
// by the Stream Deck application.  Font files in node_modules aren't
// guaranteed to be accessible at runtime.  Inlining them as base64
// into the bundle makes the plugin self-contained.
//
// Bun compatibility: bun's node_modules/.bun/ uses symlinks
// internally.  realpathSync follows these to the actual font file.

const FONT_RE = /\.(ttf|otf|woff2?)$/;

/**
 * Returns `true` when the given module specifier or resolved id looks like
 * a font file that should be inlined into the bundle as a `Buffer`.
 */
export function isFontFile(id: string): boolean {
  return FONT_RE.test(id);
}

/**
 * Vite `resolveId` helper — resolves font imports to absolute
 * file-system paths so the bundler knows where to find them.
 *
 * Supports both relative paths (`../fonts/Inter-Regular.ttf`) and
 * package imports (`@fonts/inter/Inter-Regular.ttf`).
 */
export function resolveFontId(source: string, importer: string | undefined): string | null {
  if (!isFontFile(source) || !importer) return null;

  // Relative or absolute paths
  if (source.startsWith(".") || source.startsWith("/")) {
    return resolve(dirname(importer), source);
  }

  // Package paths (e.g. @fonts/inter/Inter-Regular.ttf)
  try {
    const req = createRequire(importer);
    // Follow symlinks so bun's .bun/ internal layout resolves to the real file
    return realpathSync(req.resolve(source));
  } catch {
    return null;
  }
}

/**
 * Vite `load` helper — reads a font file from disk and returns
 * a synthetic ES module whose default export is a Node.js `Buffer`
 * containing the font bytes (base-64 encoded at build time).
 *
 * Follows symlinks before reading so that bun's internal
 * `node_modules/.bun/` layout resolves to the real file.
 *
 * Async: uses `fs.promises.readFile()` to avoid blocking the bundler
 * event loop for large fonts (1-2 MB).
 */
export async function loadFont(id: string): Promise<string | null> {
  if (!isFontFile(id)) return null;
  // The id may point into bun's .bun/ directory via symlinks;
  // resolve to the real path before reading.
  const realId = safeRealpath(id) ?? id;
  const data = await readFile(realId);
  const base64 = data.toString("base64");
  return `export default Buffer.from("${base64}", "base64");`;
}

function safeRealpath(p: string): string | null {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}
