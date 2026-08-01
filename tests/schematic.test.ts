import { describe, expect, it } from "vitest";
import { normalizeDoc } from "@/core/doc";
import { boardHighlight, buildSchematic, schematicHighlight } from "@/core/schematic";
import type { HarnessDoc, Point } from "@/core/types";

const HEAD = ["Cavità", "Verso", "Funzione", "Colore", "Sezione"];

/**
 * The same T-shaped harness the routing tests use: two connectors either side
 * of a junction and a third hanging under it.
 *
 *   A ---400--- J ---600--- B
 *               |
 *              200
 *               |
 *               C
 */
function tHarness(rows: Record<string, string[][]> = {}, extra: Partial<HarnessDoc> = {}): HarnessDoc {
  return normalizeDoc({
    nodes: [
      { id: "a", x: 0, y: 0, kind: "connector", name: "A" },
      { id: "j", x: 100, y: 0, kind: "junction", name: "" },
      { id: "b", x: 200, y: 0, kind: "connector", name: "B" },
      { id: "c", x: 100, y: 100, kind: "connector", name: "C" },
    ],
    segments: [
      { id: "s1", a: "a", b: "j", len: "400 mm" },
      { id: "s2", a: "j", b: "b", len: "600 mm" },
      { id: "s3", a: "j", b: "c", len: "200 mm" },
    ],
    tables: Object.entries(rows).map(([node, r]) => ({
      id: "t" + node,
      x: 0,
      y: 0,
      kind: "table",
      node,
      head: HEAD,
      rows: r,
    })),
    ...extra,
  });
}

const wired = (): HarnessDoc =>
  tHarness({
    a: [
      ["1", "B.1", "Positivo", "rosso", "1.5 mm²"],
      ["2", "C.1", "Massa", "nero", "1.5 mm²"],
    ],
    b: [["1", "A.1", "Positivo", "rosso", "1.5 mm²"]],
    c: [["1", "A.2", "Massa", "nero", "1.5 mm²"]],
  });

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("boxes", () => {
  it("gives every connector a box and leaves the junctions out", () => {
    const model = buildSchematic(wired());
    expect(model.boxes.map((b) => b.id).sort()).toEqual(["A", "B", "C"]);
    expect(model.byName.get("A")?.nodeId).toBe("a");
    expect(model.byName.get("A")?.tableId).toBe("ta");
  });

  it("reads the cavities from the table, in the order they are written", () => {
    const model = buildSchematic(wired());
    expect(model.byName.get("A")?.pins.map((p) => p.cavity)).toEqual(["1", "2"]);
    expect(model.byName.get("A")?.pins[0]?.label).toBe("Positivo");
    expect(model.byName.get("A")?.pins[1]?.color).toBe("nero");
  });

  it("falls back to the destination when nothing says what the wire does", () => {
    const doc = tHarness({ a: [["1", "B.1", "", "rosso", ""]], b: [["1", "A.1", "", "rosso", ""]] });
    expect(buildSchematic(doc).byName.get("A")?.pins[0]?.label).toBe("B.1");
  });

  it("still gives a box to a connector with no cavity table", () => {
    const model = buildSchematic(tHarness());
    const box = model.byName.get("B");
    expect(box?.pins).toEqual([]);
    expect(box?.unknown).toBeUndefined();
  });

  it("gives a landing to a destination the drawing does not have, and marks it", () => {
    const doc = tHarness({ a: [["1", "Z.4", "Ignoto", "rosso", ""]] });
    const model = buildSchematic(doc);
    expect(model.byName.get("Z")?.unknown).toBe(true);
    expect(model.wires).toHaveLength(1);
  });

  it("never lays two boxes on top of each other", () => {
    const model = buildSchematic(wired());
    for (const a of model.boxes) {
      for (const b of model.boxes) {
        if (a === b) continue;
        expect(overlaps(a, b)).toBe(false);
      }
    }
  });
});

describe("the header", () => {
  it("says what the cavity table on the sheet says, in full", () => {
    const doc = wired();
    doc.tables[0]!.title = "A — Centralina motore (12 vie)";
    const box = buildSchematic(doc).byName.get("A");
    expect(box?.title).toBe("A — Centralina motore (12 vie)");
  });

  it("makes the box wide enough for that title", () => {
    const plain = buildSchematic(wired()).byName.get("A")!;
    const doc = wired();
    doc.tables[0]!.title = "A — Centralina motore, vano batteria, 12 vie sigillate";
    const titled = buildSchematic(doc).byName.get("A")!;
    expect(titled.w).toBeGreaterThan(plain.w);
    expect(titled.w).toBeGreaterThan(titled.title.length * 6);
  });

  it("falls back to the connector name when the table has no title", () => {
    const doc = wired();
    delete doc.tables[0]!.title;
    expect(buildSchematic(doc).byName.get("A")?.title).toBe("A");
  });
});

/**
 * A connector everything hangs off, with four connectors on it in cavity order
 * and deliberately scattered about the sheet.
 */
function hubHarness(): HarnessDoc {
  const spokes = ["A", "B", "C", "D"];
  return normalizeDoc({
    nodes: [
      { id: "h", x: 0, y: 0, kind: "connector", name: "H" },
      // the sheet order is the reverse of the cavity order on purpose: the
      // schematic must follow the wiring, not the shape of the harness
      ...spokes.map((name, i) => ({
        id: name.toLowerCase(),
        x: 300,
        y: 400 - i * 100,
        kind: "connector",
        name,
      })),
    ],
    segments: spokes.map((name) => ({
      id: "s" + name,
      a: "h",
      b: name.toLowerCase(),
      len: "100 mm",
    })),
    tables: [
      {
        id: "th",
        node: "h",
        x: 0,
        y: 0,
        kind: "table",
        head: HEAD,
        rows: spokes.map((name, i) => [String(i + 1), `${name}.1`, "Filo " + name, "rosso", ""]),
      },
      ...spokes.map((name) => ({
        id: "t" + name,
        node: name.toLowerCase(),
        x: 0,
        y: 0,
        kind: "table",
        head: HEAD,
        rows: [["1", `H.${spokes.indexOf(name) + 1}`, "Filo " + name, "rosso", ""]],
      })),
    ],
  });
}

describe("arrangement", () => {
  it("puts the connector everything hangs off in the first column", () => {
    const model = buildSchematic(hubHarness());
    const hub = model.byName.get("H")!;
    for (const name of ["A", "B", "C", "D"]) {
      expect(model.byName.get(name)!.x).toBeGreaterThan(hub.x + hub.w);
    }
  });

  it("orders a column by where its wires arrive from, not by the sheet", () => {
    const model = buildSchematic(hubHarness());
    const order = ["A", "B", "C", "D"].map((name) => model.byName.get(name)!.y);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("leaves the fan of a hub without a single crossing", () => {
    // no pair of wires swaps order between the two ends: that is what a
    // crossing is, and a fan drawn in cavity order has none. The wires cannot
    // all be straight — the cavities of one connector are closer together than
    // whole boxes can be — but they can all stay in their lane.
    const wires = buildSchematic(hubHarness()).wires;
    expect(wires.length).toBe(4);
    for (const a of wires) {
      for (const b of wires) {
        if (a === b) continue;
        const startA = a.points[0]!.y;
        const startB = b.points[0]!.y;
        const endA = a.points[a.points.length - 1]!.y;
        const endB = b.points[b.points.length - 1]!.y;
        if (startA === startB) continue;
        expect(Math.sign(startA - startB)).toBe(Math.sign(endA - endB));
      }
    }
  });

  it("leaves alone the boxes somebody has placed", () => {
    const doc = hubHarness();
    doc.schematic = { C: { x: -400, y: -400 } };
    const box = buildSchematic(doc).byName.get("C")!;
    expect({ x: box.x, y: box.y }).toEqual({ x: -400, y: -400 });
  });

  it("moves only the box that was moved, and nothing else with it", () => {
    const before = buildSchematic(hubHarness());
    const doc = hubHarness();
    // the connector everything hangs off: taking it out of the arrangement
    // would decide every column and every order differently
    doc.schematic = { H: { x: 900, y: -300 } };
    const after = buildSchematic(doc);
    for (const box of before.boxes) {
      if (box.id === "H") continue;
      const now = after.byName.get(box.id)!;
      expect({ id: box.id, x: now.x, y: now.y }).toEqual({ id: box.id, x: box.x, y: box.y });
    }
  });
});

describe("wires", () => {
  it("draws one line per wire, mirrored rows collapsed", () => {
    const model = buildSchematic(wired());
    expect(model.wires).toHaveLength(2);
  });

  it("lands on the cavity it names, at both ends", () => {
    const model = buildSchematic(wired());
    const wire = model.wires.find((w) => w.fromLabel === "A.1");
    expect(wire?.from).toEqual({ box: "A", pin: 0 });
    expect(wire?.to).toEqual({ box: "B", pin: 0 });
  });

  it("attaches to the box itself when the destination names no cavity", () => {
    const doc = tHarness({ a: [["1", "B", "Massa", "nero", ""]] });
    const wire = buildSchematic(doc).wires[0];
    expect(wire?.to).toEqual({ box: "B", pin: -1 });
  });

  it("runs square: every leg is horizontal or vertical", () => {
    const model = buildSchematic(wired());
    for (const wire of model.wires) {
      expect(wire.points.length).toBeGreaterThanOrEqual(2);
      wire.points.forEach((p: Point, i: number) => {
        const prev = wire.points[i - 1];
        if (!prev) return;
        expect(Math.abs(p.x - prev.x) < 0.01 || Math.abs(p.y - prev.y) < 0.01).toBe(true);
      });
    }
  });

  it("starts and ends on the edge of the boxes it joins", () => {
    const model = buildSchematic(wired());
    for (const wire of model.wires) {
      const from = model.byName.get(wire.from.box)!;
      const to = model.byName.get(wire.to.box)!;
      const start = wire.points[0]!;
      const end = wire.points[wire.points.length - 1]!;
      expect([from.x, from.x + from.w]).toContain(start.x);
      expect([to.x, to.x + to.w]).toContain(end.x);
      expect(start.y).toBeGreaterThanOrEqual(from.y);
      expect(start.y).toBeLessThanOrEqual(from.y + from.h);
    }
  });

  it("carries the branches it runs through, so the sheet can light them up", () => {
    const model = buildSchematic(wired());
    const wire = model.wires.find((w) => w.fromLabel === "A.1");
    expect(wire?.segments).toEqual(["s1", "s2"]);
  });

  it("never lands two wires on the same point", () => {
    // two grounds onto a ring terminal, which has no cavities to tell them
    // apart: drawn as they come, one wire would be hidden under the other
    const doc = tHarness({
      a: [
        ["1", "B", "Massa uno", "nero", ""],
        ["2", "B", "Massa due", "nero", ""],
      ],
    });
    const model = buildSchematic(doc);
    expect(model.wires).toHaveLength(2);
    const ends = model.wires.map((w) => w.points[w.points.length - 1]!.y);
    expect(Math.abs(ends[0]! - ends[1]!)).toBeGreaterThanOrEqual(4);
  });

  it("keeps every wire clear of every other one where they run together", () => {
    const model = buildSchematic(wired());
    const seen = new Set<string>();
    for (const wire of model.wires) {
      for (const p of [wire.points[0]!, wire.points[wire.points.length - 1]!]) {
        const key = `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });

  it("reads the colour as bands", () => {
    const doc = tHarness({ a: [["1", "B.1", "Massa", "bianco/nero", ""]] });
    expect(buildSchematic(doc).wires[0]?.bands).toEqual(["#ffffff", "#111111"]);
  });

  it("never runs two wires down the same line", () => {
    // deliberately crossed over: these cannot all be drawn straight, so they
    // have to come down the gutter between the boxes, each in its own lane
    const doc = tHarness({
      a: [
        ["1", "B.3", "Uno", "rosso", ""],
        ["2", "B.1", "Due", "blu", ""],
        ["3", "B.2", "Tre", "verde", ""],
      ],
      b: [
        ["1", "A.2", "Due", "blu", ""],
        ["2", "A.3", "Tre", "verde", ""],
        ["3", "A.1", "Uno", "rosso", ""],
      ],
    });

    const legs: { wire: string; x: number; from: number; to: number }[] = [];
    for (const wire of buildSchematic(doc).wires) {
      wire.points.forEach((p, i) => {
        const before = wire.points[i - 1];
        if (!before || Math.abs(before.x - p.x) > 0.01) return;
        legs.push({
          wire: wire.id,
          x: p.x,
          from: Math.min(before.y, p.y),
          to: Math.max(before.y, p.y),
        });
      });
    }
    for (const a of legs) {
      for (const b of legs) {
        if (a.wire === b.wire) continue;
        const sameLine = Math.abs(a.x - b.x) < 4;
        const together = a.from < b.to && b.from < a.to;
        expect(sameLine && together, `${a.wire} runs over ${b.wire}`).toBe(false);
      }
    }
  });
});

describe("mated pairs", () => {
  /** Two harness halves that plug into each other, wired on both sides. */
  const withJoint = (): HarnessDoc => {
    const doc = tHarness({
      a: [["1", "X.1", "Uno", "rosso", ""]],
      b: [["1", "Y.1", "Uno", "verde", ""]],
    });
    doc.nodes.push(
      { id: "x", x: 300, y: 0, kind: "connector", name: "X", style: "plug", refs: "", mate: "y" },
      { id: "y", x: 400, y: 0, kind: "connector", name: "Y", style: "plug", refs: "", mate: "x" },
    );
    doc.segments.push({ id: "sx", a: "b", b: "x", len: "100 mm", refs: "" });
    doc.tables.push(
      {
        id: "tx",
        node: "x",
        x: 0,
        y: 0,
        kind: "table",
        head: HEAD,
        rows: [["1", "A.1", "Uno", "rosso", ""]],
      },
      {
        id: "ty",
        node: "y",
        x: 0,
        y: 0,
        kind: "table",
        head: HEAD,
        rows: [["1", "B.1", "Uno", "verde", ""]],
      },
    );
    return normalizeDoc(doc);
  };

  it("draws the joint between the two boxes, once", () => {
    const model = buildSchematic(withJoint());
    expect(model.joints).toHaveLength(1);
    expect([model.joints[0]!.a, model.joints[0]!.b].sort()).toEqual(["X", "Y"]);
  });

  it("stands the two halves side by side and level, so the arrow reads", () => {
    const model = buildSchematic(withJoint());
    const x = model.byName.get("X")!;
    const y = model.byName.get("Y")!;
    expect(Math.abs(x.y - y.y)).toBeLessThan(4);
    expect(Math.abs(x.x - y.x)).toBeGreaterThan(Math.max(x.w, y.w));
  });

  it("runs the arrow from the edge of one box to the edge of the other", () => {
    const model = buildSchematic(withJoint());
    const joint = model.joints[0]!;
    const left = model.byName.get(joint.a)!;
    const right = model.byName.get(joint.b)!;
    expect(joint.from.x).toBeCloseTo(left.x + left.w, 5);
    expect(joint.to.x).toBeCloseTo(right.x, 5);
  });

  it("says nothing about a connector paired with one that is not drawn", () => {
    const doc = wired();
    doc.nodes[0]!.mate = "ghost";
    expect(buildSchematic(normalizeDoc(doc)).joints).toEqual([]);
  });
});

describe("hand-placed boxes", () => {
  it("puts a box exactly where the document says", () => {
    const doc = wired();
    doc.schematic = { A: { x: 900, y: 40 } };
    const box = buildSchematic(doc).byName.get("A");
    expect({ x: box?.x, y: box?.y }).toEqual({ x: 900, y: 40 });
    expect(box?.placed).toBe(true);
  });

  it("keeps a position only for a connector the drawing still has", () => {
    const doc = normalizeDoc({ ...wired(), schematic: { A: { x: 10, y: 20 }, GONE: { x: 0, y: 0 } } });
    expect(doc.schematic).toEqual({ A: { x: 10, y: 20 } });
  });

  it("refuses a position that is not two numbers", () => {
    const doc = normalizeDoc({ ...wired(), schematic: { A: { x: "left" }, B: null } });
    expect(doc.schematic).toBeUndefined();
  });

  it("says nothing about the layout when nobody has moved anything", () => {
    expect(normalizeDoc(wired()).schematic).toBeUndefined();
  });
});

describe("the two views pointing at each other", () => {
  it("lights the box of the connector selected on the sheet, and its wires", () => {
    const doc = wired();
    const model = buildSchematic(doc);
    const lit = schematicHighlight(model, { type: "node", id: "a" }, doc);
    expect([...lit.boxes]).toEqual(["A"]);
    expect(lit.wires.size).toBe(2);
  });

  it("lights nothing at all when nothing is selected", () => {
    const doc = wired();
    const lit = schematicHighlight(buildSchematic(doc), null, doc);
    expect(lit.boxes.size + lit.wires.size).toBe(0);
  });

  it("lights the box of a cavity table selected on the sheet", () => {
    const doc = wired();
    const model = buildSchematic(doc);
    expect([...schematicHighlight(model, { type: "table", id: "tc" }, doc).boxes]).toEqual(["C"]);
  });

  it("lights every wire that runs through a branch picked on the sheet", () => {
    const doc = wired();
    const model = buildSchematic(doc);
    const lit = schematicHighlight(model, { type: "segment", id: "s3" }, doc);
    expect([...lit.wires]).toEqual(["A.2 C.1"]);
    expect([...lit.boxes].sort()).toEqual(["A", "C"]);
  });

  it("lights the road of a wire picked in the schematic", () => {
    const model = buildSchematic(wired());
    const lit = boardHighlight(model, "A.1 B.1");
    expect([...lit.segments].sort()).toEqual(["s1", "s2"]);
    expect([...lit.nodes].sort()).toEqual(["a", "b"]);
  });

  it("lights nothing for a wire that is no longer there", () => {
    const model = buildSchematic(wired());
    const lit = boardHighlight(model, "X.1 Y.1");
    expect(lit.segments.size + lit.nodes.size).toBe(0);
  });
});
