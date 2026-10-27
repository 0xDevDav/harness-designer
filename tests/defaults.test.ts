import { describe, expect, it } from "vitest";
import { applyWireDefaults, normalizeDefaults, setDefaults } from "@/core/defaults";
import { autoLinkRow } from "@/core/autolink";
import { normalizeDoc, tableColumns } from "@/core/doc";
import { connectEnds } from "@/core/rewire";
import { setWireUnit } from "@/core/wiresize";
import type { HarnessDoc } from "@/core/types";

const HEAD = ["Cavity", "To", "Function", "Colour", "Section", "Wire type"];
const harness = (defaults?: unknown): HarnessDoc =>
  normalizeDoc({
    defaults,
    nodes: [
      { id: "a", x: 0, y: 0, kind: "connector", name: "A" },
      { id: "b", x: 200, y: 0, kind: "connector", name: "B" },
      { id: "s", x: 100, y: 100, kind: "connector", name: "S1", style: "splice" },
    ],
    segments: [
      { id: "s1", a: "a", b: "b", len: "300 mm" },
      { id: "s2", a: "a", b: "s", len: "100 mm" },
    ],
    tables: [
      {
        id: "ta",
        x: 0,
        y: 0,
        kind: "table",
        node: "a",
        head: HEAD,
        rows: [
          ["1", "", "", "", "", ""],
          ["2", "", "", "Blue", "", ""],
        ],
      },
      { id: "tb", x: 0, y: 0, kind: "table", node: "b", head: HEAD, rows: [["1", "", "", "", "", ""]] },
    ],
  });

const rowOf = (doc: HarnessDoc, table: string, cavity: string): string[] =>
  doc.tables.find((t) => t.id === table)?.rows.find((r) => r[0] === cavity) ?? [];

describe("normalizeDefaults", () => {
  it("trims, and is nothing when empty", () => {
    expect(normalizeDefaults({ color: " red ", size: "1.5", type: "GXL" })).toEqual({
      color: "red",
      size: "1.5",
      type: "GXL",
    });
    expect(normalizeDefaults({ color: "", size: " ", type: "" })).toBeUndefined();
    expect(normalizeDefaults(null)).toBeUndefined();
  });

  it("is read from a file and survives saving it", () => {
    const doc = harness({ color: "red", type: "GXL" });
    expect(doc.defaults).toEqual({ color: "red", size: "", type: "GXL" });
    expect(normalizeDoc(JSON.parse(JSON.stringify(doc))).defaults).toEqual(doc.defaults);
    expect(harness().defaults).toBeUndefined();
  });
});

describe("setDefaults", () => {
  it("changes one default and leaves the others", () => {
    const doc = harness();
    setDefaults(doc, { color: "red" });
    setDefaults(doc, { size: "1.5" });
    expect(doc.defaults).toEqual({ color: "red", size: "1.5", type: "" });
  });

  it("leaves the document with none when the last one is cleared", () => {
    const doc = harness({ color: "red" });
    setDefaults(doc, { color: "" });
    expect(doc.defaults).toBeUndefined();
  });
});

describe("applyWireDefaults", () => {
  const cols = tableColumns({ id: "t", x: 0, y: 0, kind: "table", head: HEAD, rows: [] });

  it("fills what is empty and nothing that is written", () => {
    const row = ["1", "B.1", "", "Blue", "", ""];
    applyWireDefaults(row, cols, { color: "red", size: "1.5", type: "GXL" });
    expect(row).toEqual(["1", "B.1", "", "Blue", "1.5", "GXL"]);
  });

  it("treats a dash as empty", () => {
    const row = ["1", "B.1", "", "-", "–", "-"];
    applyWireDefaults(row, cols, { color: "red", size: "1.5", type: "GXL" });
    expect(row).toEqual(["1", "B.1", "", "red", "1.5", "GXL"]);
  });

  it("pads a short row, and does nothing with no defaults", () => {
    const row = ["1"];
    applyWireDefaults(row, cols, { color: "", size: "", type: "GXL" });
    expect(row[5]).toBe("GXL");
    const same = ["1"];
    applyWireDefaults(same, cols, undefined);
    expect(same).toEqual(["1"]);
  });
});

describe("a new wire starts from the defaults", () => {
  const defaults = { color: "red", size: "1.5", type: "GXL" };

  it("when it is connected in the schematic, at both ends", () => {
    const doc = harness(defaults);
    expect(connectEnds(doc, "A.1", "B.1")).toEqual({ ok: true });
    expect(rowOf(doc, "ta", "1").slice(3)).toEqual(["red", "1.5", "GXL"]);
    expect(rowOf(doc, "tb", "1").slice(3)).toEqual(["red", "1.5", "GXL"]);
  });

  it("when its far end is a splice, which has no table to copy from", () => {
    const doc = harness(defaults);
    connectEnds(doc, "A.1", "S1");
    expect(rowOf(doc, "ta", "1").slice(3)).toEqual(["red", "1.5", "GXL"]);
  });

  it("but never over what the cavity already says", () => {
    const doc = harness(defaults);
    connectEnds(doc, "A.2", "B.1");
    expect(rowOf(doc, "ta", "2").slice(3)).toEqual(["Blue", "1.5", "GXL"]);
    expect(rowOf(doc, "tb", "1")[3]).toBe("Blue");
  });

  it("onto a cavity that has dashes, whose size it takes from the other end", () => {
    const doc = harness(defaults);
    rowOf(doc, "tb", "1").splice(3, 3, "-", "-", "");
    expect(connectEnds(doc, "A.1", "B.1")).toEqual({ ok: true });
    expect(rowOf(doc, "ta", "1").slice(3)).toEqual(["red", "1.5", "GXL"]);
    expect(rowOf(doc, "tb", "1").slice(3)).toEqual(["red", "1.5", "GXL"]);
  });

  it("when a destination is typed in the table", () => {
    const doc = harness(defaults);
    rowOf(doc, "ta", "1")[1] = "B.1";
    expect(autoLinkRow(doc, "ta", 0).status).toBe("linked");
    expect(rowOf(doc, "ta", "1").slice(3)).toEqual(["red", "1.5", "GXL"]);
    expect(rowOf(doc, "tb", "1").slice(3)).toEqual(["red", "1.5", "GXL"]);
  });

  it("not to a wire that is already linked, whose empty cells were left empty on purpose", () => {
    const doc = harness();
    rowOf(doc, "ta", "1")[1] = "B.1";
    autoLinkRow(doc, "ta", 0);
    doc.defaults = defaults;
    expect(autoLinkRow(doc, "ta", 0).status).toBe("already");
    expect(rowOf(doc, "ta", "1").slice(3)).toEqual(["", "", ""]);
  });

  it("not at all without defaults", () => {
    const doc = harness();
    connectEnds(doc, "A.1", "B.1");
    expect(rowOf(doc, "ta", "1").slice(3)).toEqual(["", "", ""]);
  });
});

describe("the default size follows the unit", () => {
  it("is converted with the rest of the sizes", () => {
    const doc = harness({ size: "1.5" });
    setWireUnit(doc, "awg");
    expect(doc.defaults?.size).toBe("16");
    setWireUnit(doc, "mm2");
    expect(doc.defaults?.size).toBe("1.5");
  });
});
