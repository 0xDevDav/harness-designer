import { describe, expect, it } from "vitest";
import { normalizeDoc } from "@/core/doc";
import { cavityTable, wireListHeadings } from "@/core/factories";
import {
  awgArea,
  nearestSize,
  parseSize,
  previewUnitChange,
  setWireUnit,
  sizesFor,
  unitLabel,
  wireUnitOf,
} from "@/core/wiresize";
import type { HarnessDoc, Table } from "@/core/types";

const table = (id: string, head: string[], rows: string[][]): Table => ({
  id,
  x: 0,
  y: 0,
  kind: "table",
  head,
  rows,
});

const docWith = (...tables: Table[]): HarnessDoc => normalizeDoc({ tables });
const HEAD = ["Cavity", "To", "Colour", "Section"];
const sections = (doc: HarnessDoc, i = 0): string[] => doc.tables[i]?.rows.map((r) => r[3] ?? "") ?? [];

describe("awgArea", () => {
  it("matches the published cross-sections", () => {
    expect(awgArea(18)).toBeCloseTo(0.823, 2);
    expect(awgArea(14)).toBeCloseTo(2.08, 2);
    expect(awgArea(10)).toBeCloseTo(5.26, 2);
    expect(awgArea(0)).toBeCloseTo(53.5, 1);
  });
});

describe("nearestSize", () => {
  it("takes the usual pairings for the sizes a harness is built from", () => {
    const awg = (mm2: number): string => nearestSize(mm2, "awg").label;
    expect([0.35, 0.5, 0.75, 1.5, 2.5, 4, 6, 10, 16, 25, 35, 50].map(awg)).toEqual([
      "22",
      "20",
      "18",
      "16",
      "14",
      "12",
      "10",
      "8",
      "6",
      "4",
      "2",
      "1/0",
    ]);
  });

  it("goes the other way too", () => {
    const mm2 = (gauge: number): string => nearestSize(awgArea(gauge), "mm2").label;
    expect([22, 20, 18, 16, 14, 12, 10].map(mm2)).toEqual(["0.35", "0.5", "0.75", "1.5", "2", "3", "5"]);
  });

  it("offers each unit's sizes finest first", () => {
    for (const unit of ["mm2", "awg"] as const) {
      const areas = sizesFor(unit).map((s) => s.area);
      expect([...areas].sort((a, b) => a - b)).toEqual(areas);
    }
  });
});

describe("parseSize", () => {
  it("reads a bare number in the unit it is given", () => {
    expect(parseSize("1.5", "mm2")?.area).toBeCloseTo(1.5);
    expect(parseSize("18", "awg")?.area).toBeCloseTo(0.823, 2);
  });

  it("accepts a decimal comma and the usual ways of naming the unit", () => {
    expect(parseSize("0,75", "mm2")?.area).toBeCloseTo(0.75);
    expect(parseSize("0.75 mm²", "awg")).toMatchObject({ unit: "mm2", figure: "0.75" });
    expect(parseSize("1.5mm2", "awg")).toMatchObject({ unit: "mm2" });
    expect(parseSize("16 AWG", "mm2")).toMatchObject({ unit: "awg", figure: "16" });
    expect(parseSize("AWG 16", "mm2")).toMatchObject({ unit: "awg", figure: "16" });
  });

  it("reads 1/0 as a gauge whatever the drawing is in", () => {
    expect(parseSize("1/0", "mm2")).toMatchObject({ unit: "awg" });
    expect(parseSize("1/0", "mm2")?.area).toBeCloseTo(53.5, 1);
  });

  it("does not take other text for a size", () => {
    for (const text of ["", "shielded", "2x0.5", "see note", "0", "-1", "1.5 kg"]) {
      expect(parseSize(text, "mm2")).toBeNull();
    }
  });
});

describe("wireUnitOf", () => {
  it("is what the drawing says", () => {
    const doc = docWith(table("t", HEAD, []));
    doc.wireUnit = "awg";
    expect(wireUnitOf(doc)).toBe("awg");
  });

  it("is read from the heading of an older drawing, and is metric when that says nothing", () => {
    expect(wireUnitOf(docWith(table("t", ["Cavity", "To", "AWG"], [])))).toBe("awg");
    expect(wireUnitOf(docWith(table("t", ["Cavity", "To", "mm²"], [])))).toBe("mm2");
    expect(wireUnitOf(docWith(table("t", HEAD, [])))).toBe("mm2");
    expect(wireUnitOf(docWith())).toBe("mm2");
  });

  it("survives saving and opening, and ignores anything else", () => {
    expect(normalizeDoc({ wireUnit: "awg" }).wireUnit).toBe("awg");
    expect(normalizeDoc({ wireUnit: "mm2" }).wireUnit).toBe("mm2");
    expect(normalizeDoc({ wireUnit: "furlongs" }).wireUnit).toBeUndefined();
    expect(normalizeDoc({}).wireUnit).toBeUndefined();
  });
});

describe("setWireUnit", () => {
  const rows = [
    ["1", "B.1", "Red", "0.5"],
    ["2", "B.2", "Blue", "1.5"],
    ["3", "B.3", "Black", "2.5"],
  ];

  it("converts every size and renames the column", () => {
    const doc = docWith(
      table(
        "t",
        HEAD,
        rows.map((r) => [...r]),
      ),
    );
    expect(setWireUnit(doc, "awg")).toEqual({ converted: 3, skipped: 0 });
    expect(sections(doc)).toEqual(["20", "16", "14"]);
    expect(doc.tables[0]?.head?.[3]).toBe("AWG");
    expect(doc.wireUnit).toBe("awg");
  });

  it("converts the tables of every connector, and the wire list", () => {
    const doc = docWith(
      table("a", HEAD, [["1", "B.1", "Red", "1.5"]]),
      table("b", HEAD, [["1", "A.1", "Red", "1.5"]]),
      table(
        "w",
        ["#", "From", "To", "Function", "Colour", "Section", "Length"],
        [["1", "A.1", "B.1", "", "Red", "1.5", ""]],
      ),
    );
    setWireUnit(doc, "awg");
    expect(sections(doc, 0)).toEqual(["16"]);
    expect(sections(doc, 1)).toEqual(["16"]);
    expect(doc.tables[2]?.rows[0]?.[5]).toBe("16");
    expect(doc.tables[2]?.head?.[5]).toBe("AWG");
  });

  it("leaves the tables that have no section alone", () => {
    const doc = docWith(table("n", ["#", "Note"], [["1", "keep"]]));
    setWireUnit(doc, "awg");
    expect(doc.tables[0]).toMatchObject({ head: ["#", "Note"], rows: [["1", "keep"]] });
  });

  it("leaves blanks blank and text that is not a size as it was typed", () => {
    const doc = docWith(
      table("t", HEAD, [
        ["1", "", "", ""],
        ["2", "", "", "shielded pair"],
        ["3", "", "", "1.5"],
      ]),
    );
    expect(setWireUnit(doc, "awg")).toEqual({ converted: 1, skipped: 1 });
    expect(sections(doc)).toEqual(["", "shielded pair", "16"]);
  });

  it("reads bare numbers in the unit the drawing is in", () => {
    const doc = docWith(table("t", ["Cavity", "To", "Colour", "AWG"], [["1", "B.1", "Red", "18"]]));
    setWireUnit(doc, "mm2");
    expect(sections(doc)).toEqual(["0.75"]);
  });

  it("trusts a size that names its own unit over the drawing's", () => {
    const doc = docWith(table("t", HEAD, [["1", "B.1", "Red", "16 AWG"]]));
    setWireUnit(doc, "mm2");
    expect(sections(doc)).toEqual(["1.5"]);
  });

  it("leaves a size that is not a standard one alone when the unit does not change", () => {
    const doc = docWith(table("t", HEAD, [["1", "B.1", "Red", "0.6"]]));
    setWireUnit(doc, "mm2");
    expect(sections(doc)).toEqual(["0.6"]);
    expect(doc.tables[0]?.head?.[3]).toBe("mm²");
  });

  it("tidies a unit written into a cell when it is the one being switched to", () => {
    const doc = docWith(table("t", HEAD, [["1", "B.1", "Red", "18 AWG"]]));
    doc.wireUnit = "awg";
    expect(setWireUnit(doc, "awg")).toEqual({ converted: 1, skipped: 0 });
    expect(sections(doc)).toEqual(["18"]);
  });

  it("keeps the table readable by the rest of the application", () => {
    const doc = docWith(table("t", HEAD, [["1", "B.1", "Red", "1.5"]]));
    setWireUnit(doc, "awg");
    setWireUnit(doc, "mm2");
    expect(wireUnitOf(doc)).toBe("mm2");
    expect(doc.tables[0]?.head).toEqual(["Cavity", "To", "Colour", "mm²"]);
  });

  it("agrees with itself at both ends of a wire", () => {
    const doc = docWith(
      table("a", HEAD, [["1", "B.1", "Red", "2.5"]]),
      table("b", HEAD, [["1", "A.1", "Red", "2.5"]]),
    );
    setWireUnit(doc, "awg");
    expect(sections(doc, 0)).toEqual(sections(doc, 1));
  });
});

describe("new tables follow the drawing's unit", () => {
  const t = (key: string): string => key;

  it("heads a new cavity table with the unit", () => {
    expect(cavityTable(t, 0, 0, undefined, "awg").head?.[2]).toBe("AWG");
    expect(cavityTable(t, 0, 0, undefined, "mm2").head?.[2]).toBe("mm²");
  });

  it("keeps the plain word for a drawing that has no unit yet", () => {
    expect(cavityTable(t, 0, 0).head?.[2]).toBe("table.head.section");
  });

  it("heads the wire list the same way", () => {
    expect(wireListHeadings(t, "awg")[5]).toBe("AWG");
    expect(wireListHeadings(t)[5]).toBe("table.head.section");
    expect(unitLabel("mm2")).toBe("mm²");
  });
});

describe("previewUnitChange", () => {
  const rows = [
    ["1", "B.1", "Red", "0.5"],
    ["2", "B.2", "Blue", "1.5"],
    ["3", "B.3", "Black", "2.5"],
    ["4", "B.4", "Green", "2.5"],
    ["5", "B.5", "White", "see note"],
    ["6", "B.6", "Grey", ""],
  ];

  it("lists what a conversion would do, thinner wires first, without doing it", () => {
    const doc = docWith(
      table(
        "t",
        HEAD,
        rows.map((r) => [...r]),
      ),
    );
    const changes = previewUnitChange(doc, "awg");
    expect(changes.map((c) => [c.from, c.to, c.count])).toEqual([
      ["2.5 mm²", "14 AWG", 2],
      ["1.5 mm²", "16 AWG", 1],
      ["0.5 mm²", "20 AWG", 1],
    ]);
    expect(changes[0]?.ratio).toBeCloseTo(0.83, 2);
    expect(changes[2]?.ratio).toBeGreaterThan(1);
    // nothing was written
    expect(sections(doc)).toEqual(["0.5", "1.5", "2.5", "2.5", "see note", ""]);
    expect(doc.wireUnit).toBeUndefined();
  });

  it("shows the rounding that a round trip would do", () => {
    const doc = docWith(table("t", HEAD, [["1", "B.1", "Red", "1"]]));
    const there = previewUnitChange(doc, "awg");
    expect(there.map((c) => c.to)).toEqual(["18 AWG"]);
    setWireUnit(doc, "awg");
    const back = previewUnitChange(doc, "mm2");
    expect(back.map((c) => [c.from, c.to])).toEqual([["18 AWG", "0.75 mm²"]]);
  });

  it("is empty when there is nothing to change", () => {
    const doc = docWith(table("t", HEAD, [["1", "B.1", "Red", "16"]]));
    doc.wireUnit = "awg";
    expect(previewUnitChange(doc, "awg")).toEqual([]);
    expect(previewUnitChange(docWith(table("t", ["Cavity", "To"], [["1", "B.1"]])), "awg")).toEqual([]);
  });

  it("leaves out a size that comes out as the same wire", () => {
    // 0.52 mm² is 20 AWG to within a fifth of a percent: nobody needs warning about that
    const doc = docWith(
      table("t", HEAD, [
        ["1", "B.1", "Red", "0.52"],
        ["2", "B.2", "Blue", "1.5"],
      ]),
    );
    expect(previewUnitChange(doc, "awg").map((c) => c.from)).toEqual(["1.5 mm²"]);
  });
});
