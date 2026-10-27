import { describe, expect, it } from "vitest";
import { isVeryDark } from "@/core/colors";
import { setDrawingTheme, wireHalo } from "@/render/palette";

describe("black wires on the dark sheet", () => {
  it("tells black and near black from the colours that show up by themselves", () => {
    for (const c of ["black", "#111111", "#000", "nero"]) expect(isVeryDark(c)).toBe(true);
    for (const c of ["red", "blue", "brown", "green", "white", "yellow", "violet", "gray"]) {
      expect(isVeryDark(c)).toBe(false);
    }
  });

  it("outlines a black wire in the dark guise only", () => {
    setDrawingTheme("dark");
    expect(wireHalo("#111111")).not.toBeNull();
    expect(wireHalo("red")).toBeNull();
    setDrawingTheme("light");
    expect(wireHalo("#111111")).toBeNull();
  });
});
