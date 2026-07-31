import { describe, expect, it } from "vitest";
import { normalizeDoc } from "@/core/doc";
import { formatLengthMm, parseLengthMm } from "@/core/length";
import { findPath, pathLengthMm, routeWires, segmentLoad, wireRowsWithLength } from "@/core/routing";
import type { HarnessDoc } from "@/core/types";

const HEAD = ["Cavità", "Verso", "Funzione", "Colore", "Sezione"];

/**
 * A harness shaped like a T: two connectors on the left and right of a
 * junction, and a third hanging below it.
 *
 *   A ---400--- J ---600--- B
 *               |
 *              200
 *               |
 *               C
 */
function tHarness(rows: Record<string, string[][]> = {}): HarnessDoc {
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
  });
}

describe("length", () => {
  it("reads the spellings a drawing actually uses", () => {
    expect(parseLengthMm("600 mm")).toBe(600);
    expect(parseLengthMm("1,2 m")).toBe(1200);
    expect(parseLengthMm("1.2m")).toBe(1200);
    expect(parseLengthMm("12 ft")).toBeCloseTo(3657.6);
    expect(parseLengthMm("250")).toBe(250);
  });

  it("rejects anything that is not a measurement, quietly", () => {
    expect(parseLengthMm("da definire")).toBeNull();
    expect(parseLengthMm("")).toBeNull();
    expect(parseLengthMm(undefined)).toBeNull();
    expect(parseLengthMm("0 mm")).toBeNull();
    expect(parseLengthMm("-5 mm")).toBeNull();
  });

  it("writes millimetres below a metre and metres above it", () => {
    expect(formatLengthMm(600)).toBe("600 mm");
    expect(formatLengthMm(1500)).toBe("1.5 m");
    expect(formatLengthMm(0)).toBe("");
  });
});

describe("findPath", () => {
  it("finds the chain of branches between two connectors", () => {
    const doc = tHarness();
    expect(findPath(doc, "a", "b")).toEqual(["s1", "s2"]);
    expect(findPath(doc, "a", "c")).toEqual(["s1", "s3"]);
  });

  it("returns the path in order, from the start end", () => {
    const doc = tHarness();
    expect(findPath(doc, "b", "a")).toEqual(["s2", "s1"]);
  });

  it("is empty between a node and itself", () => {
    expect(findPath(tHarness(), "a", "a")).toEqual([]);
  });

  it("returns null when nothing joins the two", () => {
    const doc = normalizeDoc({
      nodes: [
        { id: "a", x: 0, y: 0, kind: "connector", name: "A" },
        { id: "b", x: 50, y: 0, kind: "connector", name: "B" },
      ],
      segments: [],
    });
    expect(findPath(doc, "a", "b")).toBeNull();
  });
});

describe("pathLengthMm", () => {
  it("sums the branches on the way", () => {
    expect(pathLengthMm(tHarness(), ["s1", "s2"])).toBe(1000);
  });

  it("gives up entirely when one branch has no readable length", () => {
    const doc = tHarness();
    doc.segments[1]!.len = "da definire";
    // a partial sum would read as a cut length and produce scrap
    expect(pathLengthMm(doc, ["s1", "s2"])).toBeNull();
  });
});

describe("routeWires", () => {
  it("routes a wire through the junction and adds up its cut length", () => {
    const doc = tHarness({ a: [["1", "B.1", "Positivo", "rosso", "2.5"]] });
    const routes = routeWires(doc);
    expect(routes).toHaveLength(1);
    expect(routes[0]!.path).toEqual(["s1", "s2"]);
    expect(routes[0]!.lengthMm).toBe(1000);
    expect(routes[0]!.unreachable).toBe(false);
  });

  it("flags a wire between two stretches of harness that are not joined", () => {
    // B is moved onto a stretch of its own: both ends are drawn, and no chain
    // of branches runs between them, so the wire cannot be built
    const doc = normalizeDoc({
      nodes: [
        { id: "a", x: 0, y: 0, kind: "connector", name: "A" },
        { id: "j", x: 100, y: 0, kind: "junction", name: "" },
        { id: "b", x: 400, y: 0, kind: "connector", name: "B" },
        { id: "d", x: 500, y: 0, kind: "connector", name: "D" },
      ],
      segments: [
        { id: "s1", a: "a", b: "j", len: "400 mm" },
        { id: "s4", a: "b", b: "d", len: "100 mm" },
      ],
      tables: [
        { id: "ta", x: 0, y: 0, kind: "table", node: "a", head: HEAD, rows: [["1", "B.1", "", "", ""]] },
      ],
    });
    const routes = routeWires(doc);
    expect(routes[0]!.unreachable).toBe(true);
    expect(routes[0]!.lengthMm).toBeNull();
  });

  it("stays quiet while the pin-outs are filled in and the branches are not drawn yet", () => {
    const doc = normalizeDoc({
      nodes: [
        { id: "a", x: 0, y: 0, kind: "connector", name: "A" },
        { id: "b", x: 200, y: 0, kind: "connector", name: "B" },
      ],
      segments: [],
      tables: [
        { id: "ta", x: 0, y: 0, kind: "table", node: "a", head: HEAD, rows: [["1", "B.1", "", "", ""]] },
      ],
    });
    expect(routeWires(doc)[0]!.unreachable).toBe(false);
  });

  it("leaves a wire pointing at a connector that does not exist to the cross-reference rule", () => {
    const doc = tHarness({ a: [["1", "Z.9", "", "", ""]] });
    const routes = routeWires(doc);
    expect(routes[0]!.unreachable).toBe(false);
    expect(routes[0]!.path).toEqual([]);
  });

  it("does not route the same wire twice when both ends declare it", () => {
    const doc = tHarness({
      a: [["1", "B.1", "", "", ""]],
      b: [["1", "A.1", "", "", ""]],
    });
    expect(routeWires(doc)).toHaveLength(1);
  });
});

describe("segmentLoad", () => {
  it("counts how many wires run through each branch", () => {
    const doc = tHarness({
      a: [
        ["1", "B.1", "", "", ""],
        ["2", "B.2", "", "", ""],
        ["3", "C.1", "", "", ""],
      ],
    });
    const load = segmentLoad(routeWires(doc));
    expect(load.get("s1")).toBe(3); // every wire leaves A
    expect(load.get("s2")).toBe(2); // two carry on to B
    expect(load.get("s3")).toBe(1); // one turns off to C
  });
});

describe("wireRowsWithLength", () => {
  it("puts the computed length on the row, and leaves it off when unknown", () => {
    const doc = tHarness({
      a: [
        ["1", "B.1", "", "", ""],
        ["2", "C.1", "", "", ""],
      ],
    });
    doc.segments.find((s) => s.id === "s3")!.len = "";
    const rows = wireRowsWithLength(doc);
    expect(rows[0]!.lengthMm).toBe(1000);
    expect(rows[1]!.lengthMm).toBeUndefined();
  });
});
