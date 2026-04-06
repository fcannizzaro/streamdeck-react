// ── Class Name Concatenation Helper ─────────────────────────────────
// Generic utility for composing CSS class strings, filtering out falsy
// values.  Functionally identical to clsx/classnames.
//
// The actual class→style resolution is handled by Takumi's built-in
// Tailwind parser via the `tw` prop.  This utility just concatenates
// class strings for use in `className`.

/**
 * Concatenates CSS class strings, filtering out falsy values.
 *
 * @example
 * ```tsx
 * <div className={cn("flex items-center", pressed && "bg-green-500")} />
 * ```
 */
export function cn(...args: Array<string | false | null | undefined | 0>): string {
  return args.filter(Boolean).join(" ");
}

/**
 * Backward-compatible alias for `cn`.
 *
 * @deprecated Use `cn` instead. `tw` will be removed in a future major version.
 */
export const tw: typeof cn = cn;
