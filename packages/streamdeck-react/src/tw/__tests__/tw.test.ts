import { describe, expect, test } from "bun:test";
import { tw } from "@/tw/index";

describe("tw", () => {
  test("concatenates class strings", () => {
    expect(tw("flex", "items-center")).toBe("flex items-center");
  });

  test("filters out false values", () => {
    expect(tw("flex", false && "hidden", "bg-red-500")).toBe("flex bg-red-500");
  });

  test("filters out null values", () => {
    expect(tw("p-4", null, "m-2")).toBe("p-4 m-2");
  });

  test("filters out undefined values", () => {
    expect(tw("text-sm", undefined, "font-bold")).toBe("text-sm font-bold");
  });

  test("filters out 0 values", () => {
    expect(tw("w-full", 0, "h-full")).toBe("w-full h-full");
  });

  test("filters out empty string values", () => {
    // empty string is falsy, gets filtered by Boolean
    expect(tw("a", "" as unknown as string | false, "b")).toBe("a b");
  });

  test("returns empty string with no arguments", () => {
    expect(tw()).toBe("");
  });

  test("returns empty string when all values are falsy", () => {
    expect(tw(false, null, undefined, 0)).toBe("");
  });

  test("handles single argument", () => {
    expect(tw("flex")).toBe("flex");
  });

  test("handles conditional classes", () => {
    const isActive = true;
    const isDisabled = false;
    expect(tw("btn", isActive && "btn-active", isDisabled && "btn-disabled")).toBe(
      "btn btn-active",
    );
  });
});
