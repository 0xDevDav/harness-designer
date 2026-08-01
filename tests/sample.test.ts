import { describe, expect, it } from "vitest";
import { cavityTables, cell, findNode, nodeForTable, resolveDest } from "@/core/doc";
import { routeWires } from "@/core/routing";
import { buildSchematic } from "@/core/schematic";
import { sampleDoc } from "@/core/sample";
import { validateDoc } from "@/core/validate";
import { checkWireEnds } from "@/core/wireends";
import { buildWireList } from "@/core/wirelist";
import { t } from "@/i18n";
import { tableSize } from "@/render/tables";

/**
 * The sample is the first drawing anybody sees, and it is read as a worked
 * example of how to fill one in. So it is held to the standard the program
 * itself asks for: not one problem in the check, at any severity.
 */
const doc = sampleDoc(t);

describe("the sample drawing", () => {
  it("passes its own consistency check with nothing to report", () => {
    const issues = validateDoc(doc, t);
    expect(issues.map((i) => `${i.severity}: ${i.message}`)).toEqual([]);
  });

  it("breaks the two-ends rule nowhere", () => {
    const report = checkWireEnds(doc);
    expect(report.conflicts.map((c) => `${c.label} in ${c.owners.join(", ")}`)).toEqual([]);
  });

  it("draws a harness every wire can actually run through", () => {
    const routes = routeWires(doc);
    expect(routes.length).toBeGreaterThan(70);
    for (const route of routes) {
      expect(route.unreachable).toBe(false);
      expect(route.path.length).toBeGreaterThan(0);
    }
  });

  it("gives every wire a cut length, because every branch has one", () => {
    for (const route of routeWires(doc)) {
      // a wire crossing a joint is two wires and has no single length: that is
      // the one case where the figure is deliberately missing
      if (route.jointed) continue;
      expect(route.lengthMm).not.toBeNull();
    }
  });

  it("fills in every cavity of every connector", () => {
    for (const { table, cols, owner } of cavityTables(doc)) {
      table.rows.forEach((row, i) => {
        expect(cell(row, cols.cavity)).toBe(String(i + 1));
        expect(cell(row, cols.dest)).not.toBe("");
        expect(cell(row, cols.func)).not.toBe("");
      });
      expect(owner).not.toBe("");
    }
  });

  it("ties every cavity table to the connector it belongs to", () => {
    for (const table of doc.tables) {
      if (table.kind !== "table" || !table.head?.some((h) => /cavit|cavity/i.test(h))) continue;
      expect(nodeForTable(doc, table)?.name).toBe(table.title?.split(" ")[0]);
    }
  });

  it("keeps a colour and a section on every wire that is not a spare cavity", () => {
    for (const row of buildWireList(doc)) {
      if (row.to === "n.c.") continue;
      expect(row.color).not.toBe("");
      expect(row.section).not.toBe("");
      expect(row.func).not.toBe("");
    }
  });
});

describe("what the sample shows off", () => {
  it("has two mated pairs, both of them reciprocal", () => {
    const pairs = doc.nodes.filter((n) => n.mate);
    expect(pairs.map((n) => n.name).sort()).toEqual(["BH-C", "BH-E", "IL-A", "IL-B"]);
    for (const node of pairs) expect(findNode(doc, node.mate!)?.mate).toBe(node.id);
  });

  it("changes the colour of a circuit across each joint, which is the point of one", () => {
    const colourAt = (owner: string, cavity: string): string => {
      const ct = cavityTables(doc).find((c) => c.owner === owner);
      const row = ct?.table.rows.find((r) => cell(r, ct.cols.cavity) === cavity);
      return cell(row, ct?.cols.color);
    };
    // the same signal, either side of the bulkhead and of the flying pair
    expect(colourAt("BH-E", "1")).not.toBe(colourAt("BH-C", "1"));
    expect(colourAt("IL-A", "1")).not.toBe(colourAt("IL-B", "1"));
  });

  it("carries the battery, its ground and the main fuse", () => {
    expect(findNode(doc, "BAT")?.style).toBe("ring");
    const battery = cavityTables(doc).find((c) => c.owner === "BAT");
    expect(battery?.table.rows.map((r) => cell(r, battery.cols.dest))).toEqual(["FB.1", "G3"]);
    expect(doc.inlines.some((i) => i.text === "FUS 40A")).toBe(true);
  });

  it("has a splice feeding the coils and the injectors", () => {
    const fed = buildWireList(doc).filter((w) => w.from === "S3" || w.to === "S3");
    expect(fed).toHaveLength(9); // eight cylinders' worth, plus the feed itself
  });

  it("spells out every note it refers to", () => {
    const notes = doc.tables.find((tb) => tb.id === "notes");
    const known = new Set(notes?.rows.map((r) => r[0]));
    const referenced = new Set<string>();
    for (const n of doc.nodes) for (const num of n.refs.match(/\d+/g) ?? []) referenced.add(num);
    for (const s of doc.segments) for (const num of s.refs.match(/\d+/g) ?? []) referenced.add(num);
    expect([...referenced].filter((n) => !known.has(n))).toEqual([]);
    expect(referenced.size).toBe(known.size);
  });
});

describe("how the sample is laid out", () => {
  const boxes = doc.tables.map((table) => {
    const { w, h } = tableSize(table, doc.meta, t);
    return { id: table.id, x: table.x, y: table.y, w, h };
  });

  it("lays no table on top of another", () => {
    // a couple of units of tolerance: the sheet is arranged by hand and two
    // tables set side by side may share an edge. What this is guarding against
    // is one table covering another, not two of them touching.
    const TOUCH = 2;
    for (const a of boxes) {
      for (const b of boxes) {
        if (a.id === b.id) continue;
        const over = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const down = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        expect(over > TOUCH && down > TOUCH, `${a.id} covers ${b.id}`).toBe(false);
      }
    }
  });

  it("keeps every cavity table within arm's length of its connector", () => {
    // A pin-out is read against the connector it describes, so it is placed
    // beside it rather than in a block of tables somewhere else on the sheet.
    // The exact spot is a decision taken by hand; this only holds it to the
    // reason for the decision.
    for (const table of doc.tables) {
      if (!table.node) continue;
      const node = findNode(doc, table.node)!;
      const box = boxes.find((b) => b.id === table.id)!;
      const away = Math.hypot(
        Math.max(box.x - node.x, node.x - (box.x + box.w), 0),
        Math.max(box.y - node.y, node.y - (box.y + box.h), 0),
      );
      expect(away, `${table.id} is adrift of ${table.node}`).toBeLessThan(260);
    }
  });

  it("draws no two wires of the schematic on top of each other", () => {
    // seventy-odd wires in a dozen gutters: if lanes and ports were not spread,
    // this is where two wires would be drawn as one
    const legs: { wire: string; x: number; from: number; to: number }[] = [];
    for (const wire of buildSchematic(doc).wires) {
      wire.points.forEach((p, i) => {
        const before = wire.points[i - 1];
        if (!before || Math.abs(before.x - p.x) > 0.01) return;
        legs.push({ wire: wire.id, x: p.x, from: Math.min(before.y, p.y), to: Math.max(before.y, p.y) });
      });
    }
    expect(legs.length).toBeGreaterThan(20);
    for (const a of legs) {
      for (const b of legs) {
        if (a.wire === b.wire) continue;
        const sameLine = Math.abs(a.x - b.x) < 4;
        const together = a.from < b.to - 1 && b.from < a.to - 1;
        expect(sameLine && together, `${a.wire} runs over ${b.wire}`).toBe(false);
      }
    }
  });

  it("reads as a schematic with no connector left dangling", () => {
    const model = buildSchematic(doc);
    expect(model.boxes.filter((b) => b.unknown)).toEqual([]);
    expect(model.boxes).toHaveLength(doc.nodes.filter((n) => n.name).length);
    expect(model.wires.length).toBeGreaterThan(70);
  });
});

describe("the destinations", () => {
  it("names only connectors the drawing has", () => {
    const names = new Set(doc.nodes.map((n) => n.name).filter(Boolean));
    for (const { table, cols } of cavityTables(doc)) {
      for (const row of table.rows) {
        const dest = cell(row, cols.dest);
        if (!dest || dest === "n.c.") continue;
        const target = resolveDest(row, cols)?.connector ?? dest;
        expect(names.has(target), `unknown destination ${dest}`).toBe(true);
      }
    }
  });
});
