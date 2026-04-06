// ── CSS Theme System ────────────────────────────────────────────────
//
// Provides a centralized design token system that maps token names
// to CSS custom properties.  Tokens are injected as inline `style`
// on the root container of every React root, making them available
// in Tailwind v4 arbitrary values: `bg-[var(--color-primary)]`.
//
// Why CSS custom properties (not Tailwind config):
//   Takumi's built-in Tailwind parser has no concept of a config file.
//   It resolves standard Tailwind utility classes from a hardcoded set.
//   Custom tokens cannot be added to Takumi's class resolution, but
//   Takumi DOES resolve `var()` in arbitrary values (`bg-[var(--x)]`).
//   CSS custom properties set via `style` on the root container node
//   cascade to all children, making them available everywhere.
//
// Architecture:
//
//   defineTheme({ colors: { primary: "#4CAF50" }, spacing: { sm: "4px" } })
//     │
//     └─ ThemeDefinition { variables: { "--color-primary": "#4CAF50", "--spacing-sm": "4px" } }
//
//   createPlugin({ theme, ... })
//     │
//     └─ ThemeContext.Provider (value = ThemeDefinition)
//          │
//          └─ Root container `<div style={{ "--color-primary": "#4CAF50", ... }}>`
//               │
//               └─ User component: `className="bg-[var(--color-primary)]"`
//
// Dynamic themes:
//   `useTheme()` returns [variables, setTheme].  Calling setTheme()
//   replaces the CSS variable map, triggering re-render of all roots.
//   This enables runtime light/dark switching.

// ── Types ───────────────────────────────────────────────────────────

/** Flat map of CSS variable names to their values. */
export type ThemeVariables = Record<string, string>;

/** Input shape for defineTheme — organized by category. */
export interface ThemeInput {
  colors?: Record<string, string>;
  spacing?: Record<string, string>;
  fontSize?: Record<string, string>;
  borderRadius?: Record<string, string>;
  /** Arbitrary category. Keys become `--{category}-{key}`. */
  [category: string]: Record<string, string> | undefined;
}

/** Resolved theme definition with flattened CSS variables. */
export interface ThemeDefinition {
  /** Flat map of CSS variable names (e.g. `"--color-primary"`) to values. */
  readonly variables: ThemeVariables;
}

// ── defineTheme ─────────────────────────────────────────────────────

/**
 * Create a theme definition from categorized design tokens.
 *
 * Each category's keys are flattened into CSS custom properties
 * with the pattern `--{category}-{key}`.  Category names are
 * singularized where conventional:
 *   - `colors` → `--color-{key}`
 *   - `fontSize` → `--font-size-{key}`
 *   - `borderRadius` → `--border-radius-{key}`
 *
 * @example
 * ```ts
 * const theme = defineTheme({
 *   colors: { primary: "#4CAF50", surface: "#1a1a2e" },
 *   spacing: { sm: "4px", md: "8px", lg: "16px" },
 *   fontSize: { body: "14px", heading: "24px" },
 * });
 *
 * // In components:
 * // className="bg-[var(--color-primary)] p-[var(--spacing-md)]"
 * ```
 */
export function defineTheme(input: ThemeInput): ThemeDefinition {
  const variables: ThemeVariables = {};

  for (const [category, tokens] of Object.entries(input)) {
    if (tokens == null || typeof tokens !== "object") continue;

    const prefix = categoryToPrefix(category);

    for (const [key, value] of Object.entries(tokens)) {
      const varName = `--${prefix}-${camelToKebab(key)}`;
      variables[varName] = value;
    }
  }

  return { variables };
}

// ── Category Name Normalization ─────────────────────────────────────
//
// Converts category names to CSS variable prefixes:
//   "colors"       → "color"
//   "fontSize"     → "font-size"
//   "borderRadius" → "border-radius"
//   "spacing"      → "spacing"  (no change for non-plural)
//
// The singular form is used because CSS custom property convention
// uses singular nouns: `--color-primary`, not `--colors-primary`.

const CATEGORY_SINGULAR: Record<string, string> = {
  colors: "color",
};

function categoryToPrefix(category: string): string {
  const singular = CATEGORY_SINGULAR[category];
  if (singular) return singular;
  return camelToKebab(category);
}

// ── camelCase → kebab-case ──────────────────────────────────────────

function camelToKebab(str: string): string {
  return str.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

// ── mergeThemes ─────────────────────────────────────────────────────
//
// Merges multiple theme definitions.  Later themes override earlier
// ones for the same variable name.

/**
 * Merge multiple theme definitions. Later themes take precedence.
 *
 * @example
 * ```ts
 * const base = defineTheme({ colors: { primary: "#4CAF50" } });
 * const dark = defineTheme({ colors: { primary: "#81C784", surface: "#121212" } });
 * const merged = mergeThemes(base, dark);
 * // merged.variables = { "--color-primary": "#81C784", "--color-surface": "#121212" }
 * ```
 */
export function mergeThemes(...themes: ThemeDefinition[]): ThemeDefinition {
  const variables: ThemeVariables = {};
  for (const theme of themes) {
    Object.assign(variables, theme.variables);
  }
  return { variables };
}
