import { describe, expect, test } from "bun:test";
import { cn, tw } from "@/cn/index";

describe("cn", () => {
  test("concatenates class strings", () => {
    expect(cn("flex", "items-center")).toBe("flex items-center");
  });

  test("filters out false values", () => {
    expect(cn("flex", false && "hidden", "bg-red-500")).toBe("flex bg-red-500");
  });

  test("filters out null values", () => {
    expect(cn("p-4", null, "m-2")).toBe("p-4 m-2");
  });

  test("filters out undefined values", () => {
    expect(cn("text-sm", undefined, "font-bold")).toBe("text-sm font-bold");
  });

  test("filters out 0 values", () => {
    expect(cn("w-full", 0, "h-full")).toBe("w-full h-full");
  });

  test("filters out empty string values", () => {
    // empty string is falsy, gets filtered by Boolean
    expect(cn("a", "" as unknown as string | false, "b")).toBe("a b");
  });

  test("returns empty string with no arguments", () => {
    expect(cn()).toBe("");
  });

  test("returns empty string when all values are falsy", () => {
    expect(cn(false, null, undefined, 0)).toBe("");
  });

  test("handles single argument", () => {
    expect(cn("flex")).toBe("flex");
  });

  test("handles conditional classes", () => {
    const isActive = true;
    const isDisabled = false;
    expect(cn("btn", isActive && "btn-active", isDisabled && "btn-disabled")).toBe(
      "btn btn-active",
    );
  });
});

describe("tw (backward-compatible alias)", () => {
  test("tw is the same function as cn", () => {
    expect(tw).toBe(cn);
  });

  test("tw produces identical output", () => {
    expect(tw("flex", false && "hidden", "bg-red-500")).toBe("flex bg-red-500");
  });
});
