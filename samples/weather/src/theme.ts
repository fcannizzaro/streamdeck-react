// ── Theme ───────────────────────────────────────────────────────────
// Vivid color palette matching the reference weather plugin design.

// ── Background colors ──────────────────────────────────────────────

const BG = {
  day: "#7B9FE0", // vivid periwinkle blue
  night: "#5246A0", // rich indigo purple
  panel: "#1C1436", // deep dark purple
} as const;

/**
 * Background for a mini weather card (sub-column).
 * Same color whether focused or not — focus is shown via boxShadow only.
 */
export function getSubColBackground(isDay: boolean): string {
  return isDay ? BG.day : BG.night;
}

/**
 * Soft white glow for the focused sub-column.
 */
export function getSubColShadow(isFocused: boolean): string {
  return isFocused
    ? "inset 0 0 0 3px rgba(255,255,255,0.5), 0 0 12px rgba(255,255,255,0.25)"
    : "none";
}

/**
 * Background for the dial container area (dark, between/behind cards).
 */
export const DIAL_BACKGROUND = "#0B0B1A";

/**
 * Background for the detail overlay panel.
 */
export const DETAIL_PANEL_BG = BG.panel;
