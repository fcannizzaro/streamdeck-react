// ── Tailwind class concatenation helper ─────────────────────────────
// The actual class→style resolution is handled by Takumi's built-in
// Tailwind parser via the `tw` prop. This utility just concatenates
// class strings, filtering out falsy values (like clsx/cn).

/**
 * Concatenates Tailwind class strings, filtering out falsy values.
 *
 * @example
 * ```tsx
 * <div className={tw("flex items-center", pressed && "bg-green-500")} />
 * ```
 */
export function tw(
  ...args: Array<string | false | null | undefined | 0>
): string {
  return args.filter(Boolean).join(" ");
}
