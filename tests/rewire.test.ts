import { describe, expect, it } from "vitest";
import { normalizeDoc } from "@/core/doc";
import { HEAD_H, PIN_H, buildSchematic, targetAt, targetLabel } from "@/core/schematic";
import {
  connectEnds,
  connectViaSplice,
  detailsConflict,
  disconnectWire,
  endLabel,
  moveWireEnd,
  parseEnd,
} from "@/core/rewire";
import { routeWires } from "@/core/routing";
import type { HarnessDoc } from "@/core/types";

const HEAD = ["Cavity", "To", "Function", "Colour", "Section"];
const SPLIT = ["Cavity", "Dest", "PIN", "Function", "Colour", "Section"];

/** Three connectors of three cavities each and a splice, joined by branches. */
const harness = (): HarnessDoc =>
  normalizeDoc({
    nodes: [
      { id: "a", x: 0, y: 0, kind: "connector", name: "A" },
      { id: "b", x: 200, y: 0, kind: "connector", name: "B" },
      { id: "c", x: 400, y: 0, kind: "connector", name: "C" },
      { id: "s", x: 200, y: 100, kind: "connector", name: "S1", style: "splice" },
      { id: "j", x: 200, y: 50, kind: "junction", name: "" },
    ],
    segments: [
      { id: "s1", a: "a", b: "j", len: "300 mm" },
      { id: "s2", a: "j", b: "b", len: "300 mm" },
      { id: "s3", a: "j", b: "c", len: "300 mm" },
      { id: "s4", a: "j", b: "s", len: "100 mm" },
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
          ["1", "B.1", "Power", "Red", "1.5"],
          ["2", "", "", "", ""],
          ["3", "", "", "", ""],
        ],
      },
      {
        id: "tb",
        x: 0,
        y: 0,
        kind: "table",
        node: "b",
        head: HEAD,
        rows: [
          ["1", "A.1", "Power", "Red", "1.5"],
          ["2", "", "", "", ""],
          ["3", "", "", "", ""],
        ],
      },
      {
        id: "tc",
        x: 0,
        y: 0,
        kind: "table",
        node: "c",
        head: HEAD,
        rows: [
          ["1", "", "", "", ""],
          ["2", "", "", "", ""],
          ["3", "", "", "", ""],
        ],
      },
    ],
  });

const rowOf = (doc: HarnessDoc, table: string, cavity: string): string[] =>
  doc.tables.find((t) => t.id === table)?.rows.find((r) => r[0] === cavity) ?? [];

describe("parseEnd", () => {
  it("reads a cavity and a bare name", () => {
    expect(parseEnd("C3.2")).toEqual({ connector: "C3", cavity: "2" });
    expect(parseEnd("S1")).toEqual({ connector: "S1" });
    expect(parseEnd("not a name")).toBeNull();
    expect(endLabel({ connector: "C3", cavity: "2" })).toBe("C3.2");
  });
});

describe("connectEnds", () => {
  it("writes the wire at both ends", () => {
    const doc = harness();
    expect(connectEnds(doc, "A.2", "C.1")).toEqual({ ok: true });
    expect(rowOf(doc, "ta", "2")[1]).toBe("C.1");
    expect(rowOf(doc, "tc", "1")[1]).toBe("A.2");
  });

  it("carries the properties the near end already has", () => {
    const doc = harness();
    rowOf(doc, "ta", "2").splice(3, 2, "Blue", "0.75");
    connectEnds(doc, "A.2", "C.1");
    expect(rowOf(doc, "tc", "1").slice(3)).toEqual(["Blue", "0.75"]);
  });

  it("is what the schematic draws afterwards", () => {
    const doc = harness();
    connectEnds(doc, "A.2", "C.1");
    const wires = buildSchematic(doc).wires.map((w) => [w.fromLabel, w.toLabel].sort().join(" "));
    expect(wires).toContain("A.2 C.1");
  });

  it("connects a cavity to a splice, which has no table to write", () => {
    const doc = harness();
    expect(connectEnds(doc, "A.2", "S1")).toEqual({ ok: true });
    expect(rowOf(doc, "ta", "2")[1]).toBe("S1");
  });

  it("writes the wire on the cavity end when it is dropped from the splice", () => {
    const doc = harness();
    expect(connectEnds(doc, "S1", "A.2")).toEqual({ ok: true });
    expect(rowOf(doc, "ta", "2")[1]).toBe("S1");
  });

  it("refuses a cavity that already has a wire, and changes nothing", () => {
    const doc = harness();
    const before = JSON.stringify(doc);
    expect(connectEnds(doc, "A.2", "B.1")).toEqual({ ok: false, reason: "occupied", other: "A.1" });
    expect(JSON.stringify(doc)).toBe(before);
  });

  it("refuses a connector wired to itself", () => {
    const doc = harness();
    expect(connectEnds(doc, "A.2", "A.3")).toEqual({ ok: false, reason: "same-connector" });
  });

  it("refuses two ends with no table between them", () => {
    const doc = harness();
    expect(connectEnds(doc, "S1", "S2")).toEqual({ ok: false, reason: "no-table" });
  });

  it("adds the cavity to a table that lacks it", () => {
    const doc = harness();
    expect(connectEnds(doc, "A.2", "C.9")).toEqual({ ok: true });
    expect(rowOf(doc, "tc", "9")[1]).toBe("A.2");
  });
});

describe("moveWireEnd", () => {
  it("moves the far end to another cavity", () => {
    const doc = harness();
    expect(moveWireEnd(doc, ["A.1", "B.1"], 1, "B.2")).toEqual({ ok: true });
    expect(rowOf(doc, "ta", "1")[1]).toBe("B.2");
    expect(rowOf(doc, "tb", "2")[1]).toBe("A.1");
  });

  it("lets the cavity it left go, and takes the wire properties with it", () => {
    const doc = harness();
    moveWireEnd(doc, ["A.1", "B.1"], 1, "B.2");
    expect(rowOf(doc, "tb", "1")).toEqual(["1", "", "Power", "", ""]);
    expect(rowOf(doc, "tb", "2")).toEqual(["2", "A.1", "Power", "Red", "1.5"]);
  });

  it("moves the end to a different connector", () => {
    const doc = harness();
    expect(moveWireEnd(doc, ["A.1", "B.1"], 1, "C.3")).toEqual({ ok: true });
    expect(rowOf(doc, "ta", "1")[1]).toBe("C.3");
    expect(rowOf(doc, "tc", "3").slice(1)).toEqual(["A.1", "Power", "Red", "1.5"]);
    expect(rowOf(doc, "tb", "1")[1]).toBe("");
  });

  it("works whichever end is picked up", () => {
    const doc = harness();
    expect(moveWireEnd(doc, ["A.1", "B.1"], 0, "A.3")).toEqual({ ok: true });
    expect(rowOf(doc, "tb", "1")[1]).toBe("A.3");
    expect(rowOf(doc, "ta", "3")[1]).toBe("B.1");
    expect(rowOf(doc, "ta", "1").slice(1)).toEqual(["", "Power", "", ""]);
  });

  it("moves an end onto a splice", () => {
    const doc = harness();
    expect(moveWireEnd(doc, ["A.1", "B.1"], 1, "S1")).toEqual({ ok: true });
    expect(rowOf(doc, "ta", "1")[1]).toBe("S1");
    expect(rowOf(doc, "tb", "1")[1]).toBe("");
  });

  it("moves an end off a splice, keeping the wire on the new cavity", () => {
    const doc = harness();
    rowOf(doc, "ta", "2").splice(1, 4, "S1", "", "Green", "1");
    expect(moveWireEnd(doc, ["A.2", "S1"], 1, "C.2")).toEqual({ ok: true });
    expect(rowOf(doc, "ta", "2")[1]).toBe("C.2");
    expect(rowOf(doc, "tc", "2")[1]).toBe("A.2");
  });

  it("keeps the wire on the new cavity when the end that stays is a splice", () => {
    const doc = harness();
    rowOf(doc, "tb", "2").splice(1, 4, "S1", "", "Green", "1");
    expect(moveWireEnd(doc, ["B.2", "S1"], 0, "C.2")).toEqual({ ok: true });
    expect(rowOf(doc, "tc", "2").slice(1)).toEqual(["S1", "", "Green", "1"]);
    expect(rowOf(doc, "tb", "2").slice(1)).toEqual(["", "", "", ""]);
  });

  it("treats a dash as empty on the cavity it lands on, so the colour and size arrive", () => {
    const doc = harness();
    rowOf(doc, "tc", "2").splice(3, 2, "-", "–");
    expect(moveWireEnd(doc, ["A.1", "B.1"], 1, "C.2")).toEqual({ ok: true });
    expect(rowOf(doc, "tc", "2").slice(1)).toEqual(["A.1", "Power", "Red", "1.5"]);
    expect(rowOf(doc, "ta", "1").slice(3)).toEqual(["Red", "1.5"]);
  });

  it("takes the colour and size of the cavity it leaves when the one that stays has dashes", () => {
    const doc = harness();
    rowOf(doc, "ta", "1").splice(3, 2, "-", "-");
    expect(moveWireEnd(doc, ["A.1", "B.1"], 1, "B.2")).toEqual({ ok: true });
    expect(rowOf(doc, "ta", "1").slice(3)).toEqual(["Red", "1.5"]);
    expect(rowOf(doc, "tb", "2").slice(3)).toEqual(["Red", "1.5"]);
  });

  it("puts the properties of a wire on a cavity with dashes when the end that stays is a splice", () => {
    const doc = harness();
    rowOf(doc, "tb", "2").splice(1, 4, "S1", "", "Green", "1");
    rowOf(doc, "tc", "2").splice(3, 2, "-", "-");
    expect(moveWireEnd(doc, ["B.2", "S1"], 0, "C.2")).toEqual({ ok: true });
    expect(rowOf(doc, "tc", "2").slice(1)).toEqual(["S1", "", "Green", "1"]);
  });

  it("does not replace a real value on the cavity it lands on with the wire's own", () => {
    const doc = harness();
    rowOf(doc, "tc", "2").splice(3, 2, "Blue", "-");
    expect(moveWireEnd(doc, ["A.1", "B.1"], 1, "C.2")).toEqual({ ok: true });
    expect(rowOf(doc, "tc", "2").slice(3)).toEqual(["Blue", "1.5"]);
  });

  it("refuses a cavity that already has a wire, and changes nothing", () => {
    const doc = harness();
    connectEnds(doc, "C.1", "B.3");
    const before = JSON.stringify(doc);
    expect(moveWireEnd(doc, ["A.1", "B.1"], 1, "B.3")).toEqual({
      ok: false,
      reason: "occupied",
      other: "C.1",
    });
    expect(JSON.stringify(doc)).toBe(before);
  });

  it("does nothing when the end is dropped where it was", () => {
    const doc = harness();
    expect(moveWireEnd(doc, ["A.1", "B.1"], 1, "B.1")).toEqual({ ok: false, reason: "unchanged" });
  });

  it("refuses to bring the two ends onto one connector", () => {
    const doc = harness();
    expect(moveWireEnd(doc, ["A.1", "B.1"], 1, "A.2")).toEqual({ ok: false, reason: "same-connector" });
  });

  it("writes the destination in the form the table uses", () => {
    const doc = harness();
    const split = doc.tables.find((t) => t.id === "tb");
    if (split) {
      split.head = SPLIT;
      split.rows = [
        ["1", "A", "1", "Power", "Red", "1.5"],
        ["2", "", "", "", "", ""],
      ];
    }
    expect(moveWireEnd(doc, ["A.1", "B.1"], 1, "B.2")).toEqual({ ok: true });
    expect(rowOf(doc, "tb", "1").slice(1, 3)).toEqual(["", ""]);
    expect(rowOf(doc, "tb", "2").slice(1, 3)).toEqual(["A", "1"]);
  });

  it("leaves the whole drawing consistent for the check", () => {
    const doc = harness();
    moveWireEnd(doc, ["A.1", "B.1"], 1, "C.3");
    const wires = buildSchematic(doc).wires.map((w) => [w.fromLabel, w.toLabel].sort().join(" "));
    expect(wires).toEqual(["A.1 C.3"]);
  });
});

describe("targetAt", () => {
  const model = buildSchematic(harness());

  it("finds the cavity under a point", () => {
    const box = model.byName.get("A");
    expect(box).toBeDefined();
    const hit = box && targetAt(model, { x: box.x + 20, y: box.y + HEAD_H + PIN_H + 4 });
    expect(hit && targetLabel(hit)).toBe("A.2");
  });

  it("is not the header of a connector, nor the space round it", () => {
    const box = model.byName.get("A");
    expect(box && targetAt(model, { x: box.x + 20, y: box.y + 8 })).toBeNull();
    expect(box && targetAt(model, { x: box.x - 30, y: box.y + 40 })).toBeNull();
  });

  it("takes a splice as a whole, by its bare name", () => {
    const box = model.byName.get("S1");
    const hit = box && targetAt(model, { x: box.x + box.w / 2, y: box.y + box.h / 2 });
    expect(hit && targetLabel(hit)).toBe("S1");
  });
});

describe("disconnectWire", () => {
  it("lets go of the wire at both ends and keeps what each cavity says about it", () => {
    const doc = harness();
    expect(disconnectWire(doc, ["A.1", "B.1"])).toBe(2);
    expect(rowOf(doc, "ta", "1")).toEqual(["1", "", "Power", "Red", "1.5"]);
    expect(rowOf(doc, "tb", "1")).toEqual(["1", "", "Power", "Red", "1.5"]);
  });

  it("is gone from the schematic afterwards", () => {
    const doc = harness();
    disconnectWire(doc, ["A.1", "B.1"]);
    expect(buildSchematic(doc).wires).toHaveLength(0);
  });

  it("clears the one end that has a row when the other is a splice", () => {
    const doc = harness();
    connectEnds(doc, "A.2", "S1");
    expect(disconnectWire(doc, ["A.2", "S1"])).toBe(1);
    expect(rowOf(doc, "ta", "2")[1]).toBe("");
  });

  it("does not clear a cavity that points at something else", () => {
    const doc = harness();
    const before = JSON.stringify(rowOf(doc, "tb", "1"));
    expect(disconnectWire(doc, ["A.1", "C.3"])).toBe(0);
    expect(JSON.stringify(rowOf(doc, "tb", "1"))).toBe(before);
  });

  it("can be put back by connecting the same ends", () => {
    const doc = harness();
    disconnectWire(doc, ["A.1", "B.1"]);
    expect(connectEnds(doc, "A.1", "B.1")).toEqual({ ok: true });
    expect(rowOf(doc, "tb", "1")[1]).toBe("A.1");
  });
});

/** A.2 is a blue 2.5 wire's cavity and C.1 a red 1.5 one's, with nothing between them yet. */
const unlike = (): HarnessDoc => {
  const doc = harness();
  Object.assign(rowOf(doc, "ta", "2"), { 3: "Blue", 4: "2.5" });
  Object.assign(rowOf(doc, "tc", "1"), { 3: "Red", 4: "1.5" });
  return doc;
};

describe("a wire joining cavities that disagree about it", () => {
  const made = { kind: "new", from: "A.2" } as const;

  it("names what they disagree about", () => {
    expect(detailsConflict(unlike(), made, "C.1")).toEqual({
      start: "A.2",
      target: "C.1",
      differences: [
        { label: "Colour", start: "Blue", target: "Red" },
        { label: "Section", start: "2.5", target: "1.5" },
      ],
    });
  });

  it("is not a disagreement when one has nothing to say, or the same in other words", () => {
    const doc = unlike();
    expect(detailsConflict(doc, { kind: "new", from: "A.3" }, "C.1")).toBeNull();
    Object.assign(rowOf(doc, "tc", "1"), { 3: "blue", 4: "2,5" });
    expect(detailsConflict(doc, made, "C.1")).toBeNull();
  });

  it("is asked about a wire that is moved too, with the wire's own details", () => {
    const doc = unlike();
    const move = { kind: "move", ends: ["A.1", "B.1"], moving: 1 } as const;
    expect(detailsConflict(doc, move, "C.1")).toBeNull();
    Object.assign(rowOf(doc, "tc", "1"), { 3: "Green" });
    expect(detailsConflict(doc, move, "C.1")?.differences).toEqual([
      { label: "Colour", start: "Red", target: "Green" },
    ]);
  });

  it("gives both ends the details of the cavity the wire comes from", () => {
    const doc = unlike();
    expect(connectEnds(doc, "A.2", "C.1", "start")).toEqual({ ok: true });
    expect(rowOf(doc, "ta", "2").slice(3)).toEqual(["Blue", "2.5"]);
    expect(rowOf(doc, "tc", "1").slice(3)).toEqual(["Blue", "2.5"]);
  });

  it("gives both ends the details of the cavity it is dropped on", () => {
    const doc = unlike();
    expect(connectEnds(doc, "A.2", "C.1", "target")).toEqual({ ok: true });
    expect(rowOf(doc, "ta", "2").slice(3)).toEqual(["Red", "1.5"]);
    expect(rowOf(doc, "tc", "1").slice(3)).toEqual(["Red", "1.5"]);
  });

  it("does the same when an end is moved", () => {
    const doc = unlike();
    Object.assign(rowOf(doc, "tc", "1"), { 3: "Green", 4: "" });
    expect(moveWireEnd(doc, ["A.1", "B.1"], 1, "C.1", "target")).toEqual({ ok: true });
    expect(rowOf(doc, "ta", "1").slice(3)).toEqual(["Green", "1.5"]);
    expect(rowOf(doc, "tc", "1").slice(3)).toEqual(["Green", "1.5"]);
    expect(rowOf(doc, "tb", "1")[1]).toBe("");
  });

  it("joins them through a new splice that each keeps its own details at", () => {
    const doc = unlike();
    const result = connectViaSplice(doc, made, "C.1");
    expect(result).toEqual({ ok: true, splice: "S2" });
    expect(rowOf(doc, "ta", "2").slice(1)).toEqual(["S2", "", "Blue", "2.5"]);
    expect(rowOf(doc, "tc", "1").slice(1)).toEqual(["S2", "", "Red", "1.5"]);
    const node = doc.nodes.find((n) => n.name === "S2");
    expect(node).toMatchObject({ kind: "connector", style: "splice" });
    // it is on the way: on the junction between the two connectors, so both wires reach it
    const routed = routeWires(doc).filter((w) => `${w.wire.from} ${w.wire.to}`.includes("S2"));
    expect(routed.length).toBeGreaterThan(0);
    expect(routed.every((w) => !w.unreachable)).toBe(true);
  });

  it("puts a junction in the first branch when there is none on the way", () => {
    const doc = unlike();
    doc.segments = [{ id: "direct", a: "a", b: "c", len: "500 mm", refs: "" }];
    doc.nodes = doc.nodes.filter((n) => n.id !== "j" && n.id !== "s" && n.id !== "b");
    expect(connectViaSplice(doc, made, "C.1")).toEqual({ ok: true, splice: "S1" });
    expect(doc.nodes.filter((n) => n.kind === "junction")).toHaveLength(1);
    expect(doc.segments).toHaveLength(3);
  });

  it("refuses when the cavity it is dropped on already has a wire", () => {
    const doc = unlike();
    Object.assign(rowOf(doc, "tc", "1"), { 1: "B.3" });
    expect(connectViaSplice(doc, made, "C.1")).toEqual({ ok: false, reason: "occupied", other: "B.3" });
  });
});
