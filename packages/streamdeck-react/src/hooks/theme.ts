import { useContext, useCallback } from "react";
import { ThemeContext } from "@/context/providers";
import type { ThemeDefinition, ThemeVariables } from "@/theme/index";

// ── Theme Hook ──────────────────────────────────────────────────────
//
// Provides read/write access to the current theme's CSS variables.
//
// Reading:
//   `useTheme()` returns the current theme's flattened CSS variable map,
//   or an empty object if no theme is configured.
//
// Writing:
//   `setTheme(newTheme)` replaces the active theme definition.  All
//   roots re-render with the new CSS variables, enabling runtime
//   light/dark switching without external state management.

/**
 * Returns the current theme variables and a setter for dynamic switching.
 *
 * @example
 * ```tsx
 * function MyKey() {
 *   const [variables, setTheme] = useTheme();
 *   // variables = { "--color-primary": "#4CAF50", ... }
 *
 *   // Dynamic switch to dark theme:
 *   // setTheme(darkTheme);
 *
 *   return <div className="bg-[var(--color-primary)]">Hello</div>;
 * }
 * ```
 */
export function useTheme(): [ThemeVariables, (theme: ThemeDefinition) => void] {
  const ctx = useContext(ThemeContext);

  const setTheme = useCallback(
    (theme: ThemeDefinition) => {
      ctx.setTheme(theme);
    },
    [ctx],
  );

  return [ctx.theme?.variables ?? {}, setTheme];
}
