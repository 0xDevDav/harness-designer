import { describe, expect, it } from "vitest";
import {
  WIRE_PALETTE,
  colorOf,
  colorsOf,
  isLightColor,
  knownColorNames,
  registerColorName,
} from "@/core/colors";

describe("colorOf", () => {
  it("recognizes Italian names", () => {
    expect(colorOf("rosso")).toBe("#c62828");
    expect(colorOf("nero")).toBe("#111111");
    expect(colorOf("giallo")).toBe("#e6c700");
    expect(colorOf("marrone")).toBe("#7a4b22");
    expect(colorOf("bianco")).toBe("#ffffff");
  });

  it("recognizes English names", () => {
    expect(colorOf("red")).toBe(colorOf("rosso"));
    expect(colorOf("black")).toBe(colorOf("nero"));
    expect(colorOf("yellow")).toBe(colorOf("giallo"));
    expect(colorOf("grey")).toBe(colorOf("gray"));
  });

  it("ignores spaces and case", () => {
    expect(colorOf("  RoSsO  ")).toBe("#c62828");
  });

  it("accepts 3 and 6 digit #hex", () => {
    expect(colorOf("#f00")).toBe("#f00");
    expect(colorOf("#FF0000")).toBe("#ff0000");
  });

  it("rejects what is not a colour", () => {
    expect(colorOf("0.5 mm2")).toBeNull();
    expect(colorOf("n.c.")).toBeNull();
    expect(colorOf("")).toBeNull();
    expect(colorOf("   ")).toBeNull();
    expect(colorOf(null)).toBeNull();
    expect(colorOf(undefined)).toBeNull();
    expect(colorOf("#ff")).toBeNull();
    expect(colorOf("#ff00")).toBeNull();
    expect(colorOf("#gggggg")).toBeNull();
  });
});

describe("colorsOf", () => {
  it("returns a single band for a simple value", () => {
    expect(colorsOf("rosso")).toEqual(["#c62828"]);
  });

  it("splits multi-part values on comma, slash and plus", () => {
    expect(colorsOf("rosso,blu")).toEqual(["#c62828", "#1d4fd7"]);
    expect(colorsOf("marrone/bianco")).toEqual(["#7a4b22", "#ffffff"]);
    expect(colorsOf("giallo + nero")).toEqual(["#e6c700", "#111111"]);
    expect(colorsOf("bianco, rosso / nero")).toEqual(["#ffffff", "#c62828", "#111111"]);
  });

  it("mixes names and #hex", () => {
    expect(colorsOf("rosso/#0f0")).toEqual(["#c62828", "#0f0"]);
  });

  it("rejects the value if even one part is not a colour", () => {
    expect(colorsOf("rosso,scotch")).toBeNull();
    expect(colorsOf("0.5 mm2")).toBeNull();
    expect(colorsOf("n.c.")).toBeNull();
    expect(colorsOf("")).toBeNull();
    expect(colorsOf("   ")).toBeNull();
    expect(colorsOf(",,,")).toBeNull();
    expect(colorsOf(null)).toBeNull();
  });

  it("rejects more than four bands", () => {
    expect(colorsOf("rosso,blu,verde,nero")).toHaveLength(4);
    expect(colorsOf("rosso,blu,verde,nero,giallo")).toBeNull();
  });
});

describe("isLightColor", () => {
  it("tells light from dark", () => {
    expect(isLightColor("#ffffff")).toBe(true);
    expect(isLightColor("#000000")).toBe(false);
    expect(isLightColor("#fff")).toBe(true);
    expect(isLightColor("#000")).toBe(false);
  });

  it("accepts names as well", () => {
    expect(isLightColor("bianco")).toBe(true);
    expect(isLightColor("nero")).toBe(false);
    expect(isLightColor("giallo")).toBe(true);
    expect(isLightColor("blu")).toBe(false);
  });

  it("falls back to a mid grey on an unintelligible value", () => {
    expect(isLightColor("nessun colore")).toBe(false);
  });
});

describe("registerColorName", () => {
  it("adds a name registered by plugins and lists it", () => {
    expect(colorsOf("cavo1+cavo2")).toBeNull(); // names not registered yet
    registerColorName("  CAVO1  ", "#111111");
    expect(colorOf("cavo1")).toBe("#111111");
    expect(colorsOf("cavo1+cavo2")).toBeNull(); // "cavo2" is not registered yet
    registerColorName("cavo2", "#e6c700");
    expect(colorsOf("cavo1+cavo2")).toEqual(["#111111", "#e6c700"]);
    expect(knownColorNames()).toContain("cavo1");
    expect(knownColorNames()).toContain("rosso");
  });

  it("recognizes the standard codes without registering them", () => {
    // IEC 60757 and DIN 47002 are part of the domain: "WS/GE" is white/yellow
    expect(colorOf("ws")).toBe("#ffffff");
    expect(colorOf("BK")).toBe("#111111");
    expect(colorsOf("WS/GE")).toEqual(["#ffffff", "#e6c700"]);
    expect(colorsOf("ws/ge")).toEqual(colorsOf("bianco/giallo"));
  });
});

describe("palette and names agree", () => {
  // The picker writes a palette name into the cell, so a name colorOf cannot
  // read back would draw an empty swatch. Turquoise did exactly that.
  it("every palette name resolves back to its own colour", () => {
    for (const c of WIRE_PALETTE) {
      expect(colorOf(c.it), `Italian name of ${c.key}`).toBe(c.hex);
      expect(colorOf(c.en), `English name of ${c.key}`).toBe(c.hex);
      expect(colorOf(c.code), `code of ${c.key}`).toBe(c.hex);
    }
  });

  it("resolves turquoise, which used to be missing from the names", () => {
    expect(colorOf("turchese")).toBe("#12a4a4");
    expect(colorOf("turquoise")).toBe("#12a4a4");
    expect(colorsOf("turchese/nero")).toEqual(["#12a4a4", "#111111"]);
  });
});
