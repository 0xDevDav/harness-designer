import { describe, expect, it } from "vitest";
import { normalizeDoc } from "@/core/doc";
import { buildSchematic } from "@/core/schematic";
import { setWireColor } from "@/core/wirecolor";
import type { HarnessDoc } from "@/core/types";

const HEAD = ["Cavity", "To", "Function", "Colour", "Section"];

const harness = (): HarnessDoc =>
  normalizeDoc({
    nodes: [
      { id: "a", x: 0, y: 0, kind: "connector", name: "A" },
      { id: "j", x: 100, y: 0, kind: "junction", name: "" },
      { id: "b", x: 200, y: 0, kind: "connector", name: "B" },
      { id: "s", x: 100, y: 100, kind: "connector", name: "S1", style: "splice" },
    ],
    segments: [
      { id: "s1", a: "a", b: "j", len: "400 mm" },
      { id: "s2", a: "j", b: "b", len: "600 mm" },
      { id: "s3", a: "j", b: "s", len: "200 mm" },
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
          ["1", "B.1", "Power", "", ""],
          ["2", "S1", "Gnd", "", ""],
        ],
      },
      { id: "tb", x: 0, y: 0, kind: "table", node: "b", head: HEAD, rows: [["1", "A.1", "Power", "", ""]] },
    ],
  });

describe("setWireColor", () => {
  it("writes the colour at both ends of a wire", () => {
    const doc = harness();
    expect(setWireColor(doc, ["A.1", "B.1"], "Red")).toBe(2);
    expect(doc.tables[0]?.rows[0]?.[3]).toBe("Red");
    expect(doc.tables[1]?.rows[0]?.[3]).toBe("Red");
  });

  it("leaves other cavities alone", () => {
    const doc = harness();
    setWireColor(doc, ["A.1", "B.1"], "Red");
    expect(doc.tables[0]?.rows[1]?.[3]).toBe("");
  });

  it("colours the end that has a cavity when the other end is a splice", () => {
    const doc = harness();
    expect(setWireColor(doc, ["A.2", "S1"], "Black")).toBe(1);
    expect(doc.tables[0]?.rows[1]?.[3]).toBe("Black");
  });

  it("counts the cells it wrote when the wire already has that colour, so the caller can tell it from no column", () => {
    const doc = harness();
    setWireColor(doc, ["A.1", "B.1"], "Red");
    const before = JSON.stringify(doc);
    expect(setWireColor(doc, ["A.1", "B.1"], "Red")).toBe(2);
    expect(JSON.stringify(doc)).toBe(before);
  });

  it("clears the colour when given an empty one", () => {
    const doc = harness();
    setWireColor(doc, ["A.1", "B.1"], "Red");
    setWireColor(doc, ["A.1", "B.1"], "");
    expect(doc.tables[0]?.rows[0]?.[3]).toBe("");
  });

  it("writes nothing for a cavity that does not exist", () => {
    const doc = harness();
    expect(setWireColor(doc, ["A.9", "Z.1"], "Red")).toBe(0);
  });

  it("is what the schematic draws the wire with afterwards", () => {
    const doc = harness();
    const before = buildSchematic(doc).wires.find((w) => w.fromLabel === "A.1");
    expect(before?.bands).toBeNull();
    setWireColor(doc, ["A.1", "B.1"], "Red");
    const after = buildSchematic(doc).wires.find((w) => w.fromLabel === "A.1");
    expect(after?.color).toBe("Red");
    expect(after?.bands?.length).toBe(1);
  });

  it("pads a short row up to the Colour column", () => {
    const doc = harness();
    doc.tables[1]!.rows[0] = ["1", "A.1"];
    setWireColor(doc, ["A.1", "B.1"], "Blue");
    expect(doc.tables[1]?.rows[0]?.[3]).toBe("Blue");
  });
});
