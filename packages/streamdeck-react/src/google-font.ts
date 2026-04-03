// ── Google Font Helper ──────────────────────────────────────────────
//
// Fetches TTF font data directly from the Google Fonts CSS2 API,
// returning ready-to-use FontConfig objects that can be passed
// straight into createPlugin({ fonts }).
//
// Why TTF?
//   Google Fonts serves different formats based on the requesting
//   User-Agent.  An old browser UA string ("Mozilla/4.0") forces
//   Google to return TrueType (TTF) URLs instead of WOFF2.  TTF is
//   the safest format — supported by both the native Takumi renderer
//   and the WASM backend — so it works regardless of the user's
//   `takumi` configuration.
//
// Disk Caching:
//   Downloaded fonts are cached to `.google-fonts/` in the current
//   working directory.  On subsequent calls the helper reads directly
//   from disk, avoiding network requests entirely.  This means the
//   first build/run of a plugin downloads the fonts once, and every
//   subsequent startup is instant.
//
// Usage:
//
//   // Single weight (returns one FontConfig)
//   const inter = await googleFont("Inter", { weight: 400 });
//
//   // Multiple weights (returns FontConfig[])
//   const fonts = await googleFont("Inter", [
//     { weight: 400 },
//     { weight: 700, style: "italic" },
//   ]);
//
//   // Default: weight 400, style "normal"
//   const inter = await googleFont("Inter");

import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { join } from "node:path";
import type { FontConfig } from "@/types";

// ── Types ───────────────────────────────────────────────────────────

type FontWeight = FontConfig["weight"];
type FontStyle = FontConfig["style"];

export interface GoogleFontVariant {
  weight?: FontWeight;
  style?: FontStyle;
}

// ── Constants ───────────────────────────────────────────────────────

// Old browser UA forces Google Fonts to serve TTF instead of WOFF2.
// This is a well-known trick — Google's CDN checks the UA to decide
// which format is "best" for the client.  An ancient UA gets TTF
// because it predates WOFF2 support.
const TTF_USER_AGENT = "Mozilla/4.0";

const GOOGLE_FONTS_CSS2_BASE = "https://fonts.googleapis.com/css2";

// Cache directory name — placed in the current working directory.
// Uses a dotfile convention so it's hidden on Unix and easy to
// gitignore.  Each font variant is stored as a separate .ttf file
// with a deterministic name: `{family}-{weight}-{style}.ttf`.
const CACHE_DIR = ".google-fonts";

// ── Disk Cache ──────────────────────────────────────────────────────
//
// The cache is a simple directory of .ttf files keyed by
// `{family}-{weight}-{style}.ttf`.  No metadata file, no TTL — font
// files are immutable at a given weight/style so there's nothing to
// invalidate.  Delete the directory to force a re-download.

// Strip everything except letters, numbers, and hyphens to prevent
// path traversal via characters like `../` in the family name.  (SDR-002)
function sanitizeName(family: string): string {
  return family
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

function cacheFilePath(family: string, weight: FontWeight, style: FontStyle): string {
  return join(process.cwd(), CACHE_DIR, `${sanitizeName(family)}-${weight}-${style}.ttf`);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function ensureCacheDir(): Promise<void> {
  const dir = join(process.cwd(), CACHE_DIR);
  await mkdir(dir, { recursive: true });
}

async function readCached(
  family: string,
  weight: FontWeight,
  style: FontStyle,
): Promise<FontConfig | null> {
  const path = cacheFilePath(family, weight, style);
  if (!(await fileExists(path))) return null;

  const data = await readFile(path);
  return { name: family, data: data.buffer as ArrayBuffer, weight, style };
}

async function writeCache(
  family: string,
  weight: FontWeight,
  style: FontStyle,
  data: ArrayBuffer,
): Promise<void> {
  await ensureCacheDir();
  const path = cacheFilePath(family, weight, style);
  await writeFile(path, Buffer.from(data));
}

// ── URL Building ────────────────────────────────────────────────────
//
// The CSS2 API uses axis notation to request specific weights/styles:
//   - Weights only:           family=Inter:wght@400;700
//   - With italic axis:       family=Inter:ital,wght@0,400;1,700
//
// When any variant requests italic, we must include the `ital` axis
// for all variants — the CSS2 API requires consistent axis tuples.
// Tuples must be sorted lexicographically.

function buildCss2Url(family: string, variants: GoogleFontVariant[]): string {
  const hasItalic = variants.some((v) => v.style === "italic");
  const encodedFamily = encodeURIComponent(family);

  if (hasItalic) {
    const specs = variants.map((v) => {
      const ital = v.style === "italic" ? 1 : 0;
      const wght = v.weight ?? 400;
      return `${ital},${wght}`;
    });
    // CSS2 API requires sorted axis tuples
    specs.sort();
    return `${GOOGLE_FONTS_CSS2_BASE}?family=${encodedFamily}:ital,wght@${specs.join(";")}`;
  }

  const weights = variants.map((v) => v.weight ?? 400);
  weights.sort((a, b) => a - b);
  return `${GOOGLE_FONTS_CSS2_BASE}?family=${encodedFamily}:wght@${weights.join(";")}`;
}

// ── CSS Parsing ─────────────────────────────────────────────────────
//
// With the TTF User-Agent trick, Google returns simple @font-face
// blocks without unicode-range splitting (TTF files cover all glyphs
// in a single file).  Each block contains exactly one src url().
//
// Example response:
//
//   @font-face {
//     font-family: 'Inter';
//     font-style: normal;
//     font-weight: 400;
//     src: url(https://fonts.gstatic.com/s/inter/.../inter-latin.ttf)
//          format('truetype');
//   }

interface ParsedFontFace {
  weight: FontWeight;
  style: FontStyle;
  url: string;
}

function parseFontFaces(css: string): ParsedFontFace[] {
  const results: ParsedFontFace[] = [];
  const seen = new Set<string>();

  const blockRegex = /@font-face\s*\{([^}]+)\}/g;
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(css)) !== null) {
    const block = match[1]!;

    const urlMatch = block.match(/url\(([^)]+)\)/);
    const weightMatch = block.match(/font-weight:\s*(\d+)/);
    const styleMatch = block.match(/font-style:\s*(normal|italic)/);

    if (!urlMatch?.[1]) continue;

    const weight = Number(weightMatch?.[1] ?? 400) as FontWeight;
    const style = (styleMatch?.[1] ?? "normal") as FontStyle;

    // Deduplicate by weight+style — the TTF UA trick should yield
    // one block per variant, but guard against unexpected unicode-range
    // splits by keeping only the first match per weight/style pair.
    const key = `${weight}:${style}`;
    if (seen.has(key)) continue;
    seen.add(key);

    results.push({ url: urlMatch[1], weight, style });
  }

  return results;
}

// ── Core Fetch Logic ────────────────────────────────────────────────

async function fetchGoogleFonts(
  family: string,
  variants: GoogleFontVariant[],
): Promise<FontConfig[]> {
  // Phase 1: Check disk cache for all requested variants.
  // Any that are already cached are returned immediately.
  const results: FontConfig[] = [];
  const uncached: GoogleFontVariant[] = [];

  for (const v of variants) {
    const weight = v.weight ?? 400;
    const style = v.style ?? "normal";
    const cached = await readCached(family, weight, style);
    if (cached) {
      results.push(cached);
    } else {
      uncached.push({ weight, style });
    }
  }

  // All variants were cached — skip the network entirely.
  if (uncached.length === 0) return results;

  // Phase 2: Fetch CSS for the uncached variants only.
  const url = buildCss2Url(family, uncached);

  const cssResponse = await fetch(url, {
    headers: { "User-Agent": TTF_USER_AGENT },
  });

  if (!cssResponse.ok) {
    throw new Error(
      `Google Fonts: failed to fetch CSS for "${family}" (HTTP ${cssResponse.status})`,
    );
  }

  const css = await cssResponse.text();
  const faces = parseFontFaces(css);

  if (faces.length === 0) {
    throw new Error(
      `Google Fonts: no font faces found in CSS response for "${family}". ` +
        `Verify the family name is correct at https://fonts.google.com`,
    );
  }

  // Phase 3: Download all uncached TTF files in parallel, then
  // write each to disk cache for future runs.
  const downloaded = await Promise.all(
    faces.map(async (face) => {
      const fontResponse = await fetch(face.url);

      if (!fontResponse.ok) {
        throw new Error(
          `Google Fonts: failed to download font file for "${family}" ` +
            `weight ${face.weight} (HTTP ${fontResponse.status})`,
        );
      }

      const data = await fontResponse.arrayBuffer();

      // Write to disk cache (fire-and-forget — a failed cache write
      // should not break font loading).
      writeCache(family, face.weight, face.style, data).catch(() => {
        // Silently ignore cache write failures (e.g. read-only FS).
      });

      return {
        name: family,
        data,
        weight: face.weight,
        style: face.style,
      } satisfies FontConfig;
    }),
  );

  return [...results, ...downloaded];
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Fetch a Google Font as a ready-to-use `FontConfig`.
 *
 * Downloads TTF font data directly from Google Fonts — no npm package
 * needed. The returned config can be passed straight into
 * `createPlugin({ fonts: [...] })`.
 *
 * Font files are cached to `.google-fonts/` in the current working
 * directory. Subsequent calls read from disk without network access.
 *
 * @param family - The Google Font family name (e.g. `"Inter"`, `"Roboto"`).
 * @returns A `FontConfig` with weight 400 and normal style.
 *
 * @example
 * ```ts
 * const inter = await googleFont("Inter");
 * createPlugin({ fonts: [inter], actions: [...] });
 * ```
 */
export async function googleFont(family: string): Promise<FontConfig>;

/**
 * Fetch a specific weight/style variant of a Google Font.
 *
 * @param family  - The Google Font family name.
 * @param variant - Weight and/or style to fetch.
 * @returns A single `FontConfig`.
 *
 * @example
 * ```ts
 * const bold = await googleFont("Inter", { weight: 700 });
 * ```
 */
export async function googleFont(family: string, variant: GoogleFontVariant): Promise<FontConfig>;

/**
 * Fetch multiple weight/style variants of a Google Font in one call.
 *
 * All variants are fetched in parallel for maximum throughput.
 *
 * @param family   - The Google Font family name.
 * @param variants - Array of weight/style combinations to fetch.
 * @returns An array of `FontConfig` objects, one per variant.
 *
 * @example
 * ```ts
 * const fonts = await googleFont("Inter", [
 *   { weight: 400 },
 *   { weight: 700 },
 *   { weight: 700, style: "italic" },
 * ]);
 * createPlugin({ fonts, actions: [...] });
 * ```
 */
export async function googleFont(
  family: string,
  variants: GoogleFontVariant[],
): Promise<FontConfig[]>;

export async function googleFont(
  family: string,
  variantOrVariants?: GoogleFontVariant | GoogleFontVariant[],
): Promise<FontConfig | FontConfig[]> {
  // No variant specified → default to weight 400, normal style
  if (variantOrVariants === undefined) {
    const results = await fetchGoogleFonts(family, [{ weight: 400, style: "normal" }]);
    return results[0]!;
  }

  // Single variant object
  if (!Array.isArray(variantOrVariants)) {
    const variant = {
      weight: variantOrVariants.weight ?? 400,
      style: variantOrVariants.style ?? "normal",
    } satisfies GoogleFontVariant;
    const results = await fetchGoogleFonts(family, [variant]);
    return results[0]!;
  }

  // Multiple variants array
  const normalized = variantOrVariants.map((v) => ({
    weight: v.weight ?? 400,
    style: v.style ?? "normal",
  }));
  return fetchGoogleFonts(family, normalized);
}
