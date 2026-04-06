import { describe, expect, test } from "bun:test";
import { defineTheme, mergeThemes } from "@/theme/index";

describe("defineTheme", () => {
  test("flattens colors to CSS variables", () => {
    const theme = defineTheme({
      colors: {
        primary: "#4CAF50",
        surface: "#1a1a2e",
        "on-surface": "#e0e0e0",
      },
    });

    expect(theme.variables).toEqual({
      "--color-primary": "#4CAF50",
      "--color-surface": "#1a1a2e",
      "--color-on-surface": "#e0e0e0",
    });
  });

  test("flattens spacing to CSS variables", () => {
    const theme = defineTheme({
      spacing: {
        sm: "4px",
        md: "8px",
        lg: "16px",
      },
    });

    expect(theme.variables).toEqual({
      "--spacing-sm": "4px",
      "--spacing-md": "8px",
      "--spacing-lg": "16px",
    });
  });

  test("converts camelCase keys to kebab-case", () => {
    const theme = defineTheme({
      fontSize: {
        bodySmall: "12px",
        headingLarge: "32px",
      },
    });

    expect(theme.variables).toEqual({
      "--font-size-body-small": "12px",
      "--font-size-heading-large": "32px",
    });
  });

  test("converts camelCase category names to kebab-case", () => {
    const theme = defineTheme({
      borderRadius: {
        sm: "4px",
        lg: "12px",
      },
    });

    expect(theme.variables).toEqual({
      "--border-radius-sm": "4px",
      "--border-radius-lg": "12px",
    });
  });

  test("pluralizes 'colors' to singular 'color' in prefix", () => {
    const theme = defineTheme({
      colors: { primary: "#fff" },
    });

    expect(theme.variables["--color-primary"]).toBe("#fff");
    // NOT --colors-primary
    expect(theme.variables["--colors-primary"]).toBeUndefined();
  });

  test("handles multiple categories", () => {
    const theme = defineTheme({
      colors: { primary: "#4CAF50" },
      spacing: { md: "8px" },
      fontSize: { body: "14px" },
    });

    expect(theme.variables).toEqual({
      "--color-primary": "#4CAF50",
      "--spacing-md": "8px",
      "--font-size-body": "14px",
    });
  });

  test("handles custom categories", () => {
    const theme = defineTheme({
      opacity: {
        dim: "0.5",
        full: "1",
      },
    });

    expect(theme.variables).toEqual({
      "--opacity-dim": "0.5",
      "--opacity-full": "1",
    });
  });

  test("empty input produces empty variables", () => {
    const theme = defineTheme({});
    expect(theme.variables).toEqual({});
  });

  test("skips undefined category values", () => {
    const theme = defineTheme({
      colors: { primary: "#fff" },
      spacing: undefined,
    });

    expect(theme.variables).toEqual({
      "--color-primary": "#fff",
    });
  });
});

describe("mergeThemes", () => {
  test("merges two themes", () => {
    const base = defineTheme({ colors: { primary: "#4CAF50" } });
    const dark = defineTheme({ colors: { surface: "#121212" } });
    const merged = mergeThemes(base, dark);

    expect(merged.variables).toEqual({
      "--color-primary": "#4CAF50",
      "--color-surface": "#121212",
    });
  });

  test("later themes override earlier ones", () => {
    const base = defineTheme({ colors: { primary: "#4CAF50" } });
    const override = defineTheme({ colors: { primary: "#81C784" } });
    const merged = mergeThemes(base, override);

    expect(merged.variables["--color-primary"]).toBe("#81C784");
  });

  test("merges three themes", () => {
    const a = defineTheme({ colors: { primary: "#111" } });
    const b = defineTheme({ spacing: { sm: "4px" } });
    const c = defineTheme({ colors: { primary: "#333" }, spacing: { md: "8px" } });
    const merged = mergeThemes(a, b, c);

    expect(merged.variables).toEqual({
      "--color-primary": "#333",
      "--spacing-sm": "4px",
      "--spacing-md": "8px",
    });
  });

  test("empty merge produces empty variables", () => {
    const merged = mergeThemes();
    expect(merged.variables).toEqual({});
  });
});
