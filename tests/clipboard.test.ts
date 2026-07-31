import { describe, expect, it } from "vitest";
import { copySelection, countOf, isEmptyClipping, pasteClipping } from "@/core/clipboard";
import { cavityTables, findNode, findSegment, findTable, mateConnectors, normalizeDoc } from "@/core/doc";
import type { HarnessDoc, Selection } from "@/core/types";

const CAV_HEAD = ["Cavità", "Verso", "Colore", "Sezione"];

/** Two connectors, one branch between them, a cavity table on each. */
function twoEndDoc(): HarnessDoc {
  return normalizeDoc({
    nodes: [
      { id: "n1", x: 100, y: 100, kind: "connector", name: "C1", style: "plug", refs: "" },
      { id: "n2", x: 300, y: 100, kind: "connector", name: "C2", style: "plug", refs: "" },
    ],
    segments: [{ id: "s1", a: "n1", b: "n2", len: "500 mm", refs: "" }],
    inlines: [{ id: "i1", seg: "s1", t: 0.5, text: "COR ø13", color: "#e8942a" }],
    tables: [
      {
        id: "t1",
        x: 500,
        y: 40,
        kind: "table",
        title: "C1",
        head: CAV_HEAD,
        rows: [["1", "C2.1", "bianco", "0.75"]],
        node: "n1",
      },
    ],
  });
}

const at = (x: number, y: number): { x: number; y: number } => ({ x, y });
const sel = (type: Selection["type"], id: string): Selection => ({ type, id });

describe("copySelection", () => {
  it("brings both ends of a branch along with it", () => {
    const doc = twoEndDoc();
    const clip = copySelection(doc, [sel("segment", "s1")]);
    expect(clip.segments).toHaveLength(1);
    expect(clip.nodes.map((n) => n.id).sort()).toEqual(["n1", "n2"]);
  });

  it("shares nothing with the document it was copied from", () => {
    const doc = twoEndDoc();
    const clip = copySelection(doc, [sel("table", "t1")]);
    clip.tables[0]!.rows[0]![2] = "rosso";
    expect(findTable(doc, "t1")?.rows[0]?.[2]).toBe("bianco");
  });

  it("refuses the title block, of which there is one to a sheet", () => {
    const doc = normalizeDoc({
      nodes: [],
      segments: [],
      tables: [{ id: "tb", x: 0, y: 0, kind: "title", rows: [] }],
    });
    expect(isEmptyClipping(copySelection(doc, [sel("table", "tb")]))).toBe(true);
  });

  it("counts nothing twice when a branch and its own end are both chosen", () => {
    const doc = twoEndDoc();
    const clip = copySelection(doc, [sel("segment", "s1"), sel("node", "n1")]);
    expect(countOf(clip)).toBe(3);
  });
});

describe("pasteClipping", () => {
  it("puts the top-left corner where it was asked and keeps the shape", () => {
    const doc = twoEndDoc();
    const clip = copySelection(doc, [sel("segment", "s1")]);
    pasteClipping(doc, clip, at(400, 400), false);
    const made = doc.nodes.filter((n) => n.id !== "n1" && n.id !== "n2");
    expect(made.map((n) => [n.x, n.y]).sort()).toEqual([
      [400, 400],
      [600, 400],
    ]);
  });

  it("gives a copied connector a free name, so the pin-outs stay unambiguous", () => {
    const doc = twoEndDoc();
    pasteClipping(doc, copySelection(doc, [sel("node", "n1")]), at(0, 0), false);
    const names = doc.nodes.map((n) => n.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("C3");
  });

  it("skips a name a table has already taken", () => {
    const doc = twoEndDoc();
    doc.tables.push({ id: "t9", x: 0, y: 0, kind: "table", title: "C3", head: CAV_HEAD, rows: [] });
    pasteClipping(doc, copySelection(doc, [sel("node", "n1")]), at(0, 0), false);
    expect(doc.nodes.map((n) => n.name)).toContain("C4");
  });

  it("joins the copy of a branch to the copies of its ends, not to the originals", () => {
    const doc = twoEndDoc();
    pasteClipping(doc, copySelection(doc, [sel("segment", "s1")]), at(0, 400), false);
    const copy = doc.segments.find((s) => s.id !== "s1");
    expect(copy).toBeDefined();
    expect(copy!.a).not.toBe("n1");
    expect(copy!.b).not.toBe("n2");
    expect(findNode(doc, copy!.a)).toBeDefined();
    expect(findNode(doc, copy!.b)).toBeDefined();
  });

  it("keeps two connectors copied together plugged into each other", () => {
    const doc = twoEndDoc();
    doc.segments.push({ id: "s2", a: "n2", b: "n3", len: "", refs: "" });
    doc.nodes.push({ id: "n3", x: 500, y: 100, kind: "connector", name: "C3", style: "plug", refs: "" });
    expect(mateConnectors(doc, "n1", "n3")).toBe(true);

    const clip = copySelection(doc, [sel("node", "n1"), sel("node", "n3")]);
    const made = pasteClipping(doc, clip, at(0, 600), false);
    const pair = made.map((s) => findNode(doc, s.id)!);
    expect(pair[0]!.mate).toBe(pair[1]!.id);
    expect(pair[1]!.mate).toBe(pair[0]!.id);
  });

  it("does not plug a lone copy into a connector already taken", () => {
    const doc = twoEndDoc();
    doc.segments.push({ id: "s2", a: "n2", b: "n3", len: "", refs: "" });
    doc.nodes.push({ id: "n3", x: 500, y: 100, kind: "connector", name: "C3", style: "plug", refs: "" });
    mateConnectors(doc, "n1", "n3");

    const made = pasteClipping(doc, copySelection(doc, [sel("node", "n1")]), at(0, 600), false);
    expect(findNode(doc, made[0]!.id)?.mate).toBeUndefined();
    expect(findNode(doc, "n3")?.mate).toBe("n1");
  });

  it("leaves a copied cavity table belonging to nobody, and renames it", () => {
    const doc = twoEndDoc();
    const made = pasteClipping(doc, copySelection(doc, [sel("table", "t1")]), at(0, 600), false);
    const copy = findTable(doc, made[0]!.id)!;
    expect(copy.node).toBeUndefined();
    expect(copy.title).not.toBe("C1");
    expect(copy.rows).toEqual(findTable(doc, "t1")!.rows);
    // the point of both: C1 must not end up described by two tables, which would
    // count every wire in it twice
    expect(cavityTables(doc).filter((ct) => ct.owner === "C1")).toHaveLength(1);
  });

  it("keeps a cavity table with its connector when both are copied", () => {
    const doc = twoEndDoc();
    const clip = copySelection(doc, [sel("node", "n1"), sel("table", "t1")]);
    const made = pasteClipping(doc, clip, at(0, 600), false);
    const node = findNode(doc, made.find((s) => s.type === "node")!.id)!;
    const table = findTable(doc, made.find((s) => s.type === "table")!.id)!;
    expect(table.node).toBe(node.id);
    expect(table.title).toBe(node.name);
  });

  it("carries a label onto the copy of the branch it was on", () => {
    const doc = twoEndDoc();
    const clip = copySelection(doc, [sel("segment", "s1"), sel("inline", "i1")]);
    const made = pasteClipping(doc, clip, at(0, 600), false);
    const inline = doc.inlines.find((i) => i.id === made.find((s) => s.type === "inline")!.id)!;
    expect(inline.seg).not.toBe("s1");
    expect(findSegment(doc, inline.seg)).toBeDefined();
    expect(inline.text).toBe("COR ø13");
  });

  it("drops a label with no branch to sit on", () => {
    const doc = twoEndDoc();
    const clip = copySelection(doc, [sel("inline", "i1")]);
    clip.inlines[0]!.seg = "gone";
    expect(pasteClipping(doc, clip, at(0, 600), false)).toHaveLength(0);
  });

  it("puts a copy on the grid when snapping is on", () => {
    const doc = twoEndDoc();
    const made = pasteClipping(doc, copySelection(doc, [sel("node", "n1")]), at(347, 213), true);
    const node = findNode(doc, made[0]!.id)!;
    expect(node.x % 10).toBe(0);
    expect(node.y % 10).toBe(0);
  });
});
