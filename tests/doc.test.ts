import { describe, expect, it } from "vitest";
import { DOC_VERSION } from "@/core/types";
import type { HarnessDoc, Inline, Table } from "@/core/types";
import {
  addInline,
  cavityTables,
  deleteEntity,
  findInline,
  findNode,
  findSegment,
  addBend,
  faceNode,
  findTable,
  mateConnectors,
  mateOf,
  mergeNodes,
  nextName,
  normalizeMates,
  removeBend,
  segmentPath,
  unmateConnector,
  nodeForTable,
  normalizeConnectors,
  normalizeDoc,
  renameNode,
  splitSegment,
  tableColumns,
  tableForNode,
} from "@/core/doc";

/* ---------------- aiuti ---------------- */

const CAV_HEAD = ["Cavità", "Verso", "Colore", "Sezione"];

const inlineOf = (doc: HarnessDoc, id: string): Inline => {
  const found = findInline(doc, id);
  if (!found) throw new Error(`etichetta ${id} assente`);
  return found;
};

/** Smallest document: two nodes joined by one segment. */
function twoNodeDoc(): HarnessDoc {
  return normalizeDoc({
    nodes: [
      { id: "n1", x: 0, y: 0 },
      { id: "n2", x: 100, y: 0 },
    ],
    segments: [{ id: "s1", a: "n1", b: "n2" }],
  });
}

/* ---------------- normalizzazione ---------------- */

describe("normalizeDoc", () => {
  it("drops segments with missing ends, self-loops and duplicates", () => {
    const doc = normalizeDoc({
      nodes: [
        { id: "n1", x: 0, y: 0 },
        { id: "n2", x: 10, y: 0 },
      ],
      segments: [
        { id: "s1", a: "n1", b: "n2" },
        { id: "s2", a: "n1", b: "fantasma" },
        { id: "s3", a: "sparito", b: "n2" },
        { id: "s4", a: "n1", b: "n1" },
        { id: "s5", a: "n2", b: "n1" },
        { id: "s6" },
      ],
    });
    expect(doc.segments.map((s) => s.id)).toEqual(["s1"]);
  });

  it("drops nodes with no id or a repeated id", () => {
    const doc = normalizeDoc({
      nodes: [
        { id: "n1", x: 5, y: 5 },
        { id: "n1", x: 99, y: 99 },
        { x: 1, y: 1 },
      ],
    });
    expect(doc.nodes).toHaveLength(1);
    expect(doc.nodes[0]).toMatchObject({ id: "n1", x: 5, y: 5 });
  });

  it("normalizes non-numeric coordinates and missing fields", () => {
    const doc = normalizeDoc({ nodes: [{ id: "n1", x: "abc", y: null }] });
    expect(doc.nodes[0]).toEqual({
      id: "n1",
      x: 0,
      y: 0,
      kind: "junction",
      name: "",
      style: "plug",
      refs: "",
    });
  });

  it("drops orphan labels and clamps the parametric position", () => {
    const doc = normalizeDoc({
      nodes: [
        { id: "n1", x: 0, y: 0 },
        { id: "n2", x: 10, y: 0 },
      ],
      segments: [{ id: "s1", a: "n1", b: "n2" }],
      inlines: [
        { id: "i1", seg: "s1", t: 0.4, text: "FUS" },
        { id: "i2", seg: "sparito", t: 0.5, text: "orfana" },
        { id: "i3", seg: "s1", t: 5, text: "oltre" },
        { id: "i4", seg: "s1", t: -5, text: "prima" },
        { id: "i1", seg: "s1", t: 0.9, text: "doppione" },
        { seg: "s1", t: 0.5, text: "senza id" },
      ],
    });
    expect(doc.inlines.map((i) => i.id)).toEqual(["i1", "i3", "i4"]);
    expect(inlineOf(doc, "i3").t).toBe(0.95);
    expect(inlineOf(doc, "i4").t).toBe(0.05);
    expect(inlineOf(doc, "i1").color).toBe("#e8942a");
  });

  it("drops duplicate tables, keeping the first", () => {
    const doc = normalizeDoc({
      tables: [
        { id: "t1", x: 0, y: 0, kind: "table", title: "Prima", rows: [] },
        { id: "t1", x: 500, y: 500, kind: "table", title: "Copia", rows: [] },
        { x: 0, y: 0, kind: "table", rows: [] },
      ],
    });
    expect(doc.tables).toHaveLength(1);
    expect(doc.tables[0]?.title).toBe("Prima");
  });

  it("keeps a single title block", () => {
    const doc = normalizeDoc({
      tables: [
        { id: "a", x: 0, y: 0, kind: "title", rows: [] },
        { id: "b", x: 10, y: 10, kind: "title", rows: [] },
        { id: "c", x: 20, y: 20, kind: "table", rows: [] },
      ],
    });
    expect(doc.tables.filter((t) => t.kind === "title").map((t) => t.id)).toEqual(["a"]);
    expect(doc.tables.map((t) => t.id)).toEqual(["a", "c"]);
  });

  it("squares up rows shorter than the header", () => {
    const doc = normalizeDoc({
      tables: [
        {
          id: "t1",
          x: 0,
          y: 0,
          kind: "table",
          head: ["A", "B", "C"],
          rows: [["1"], ["1", "2", "3", "4"], []],
        },
      ],
    });
    const table = doc.tables[0];
    expect(table?.rows).toEqual([
      ["1", "", "", ""],
      ["1", "2", "3", "4"],
      ["", "", "", ""],
    ]);
  });

  it("drops a table link pointing at a node that does not exist", () => {
    const doc = normalizeDoc({
      nodes: [{ id: "n1", x: 0, y: 0, kind: "connector", name: "C1" }],
      tables: [
        { id: "t1", x: 0, y: 0, kind: "table", rows: [], node: "n1" },
        { id: "t2", x: 0, y: 0, kind: "table", rows: [], node: "sparito" },
      ],
    });
    expect(findTable(doc, "t1")?.node).toBe("n1");
    expect(findTable(doc, "t2")?.node).toBeUndefined();
  });

  it("survives irrelevant input", () => {
    for (const bad of [null, undefined, 42, "testo", [], { nodes: "no" }]) {
      const doc = normalizeDoc(bad);
      expect(doc.version).toBe(DOC_VERSION);
      expect(doc.nodes).toEqual([]);
      expect(doc.segments).toEqual([]);
    }
  });

  it("converts a document with no version and no meta, without losing nodes", () => {
    const older = {
      nodes: [
        { id: "n1", x: 400, y: 560, kind: "junction", name: "", style: "plug", refs: "" },
        { id: "n2", x: 900, y: 560, kind: "connector", name: "C1", style: "plug", refs: "[1]" },
        { id: "n3", x: 400, y: 800, kind: "connector", name: "W1", style: "ring", refs: "" },
      ],
      segments: [
        { id: "s1", a: "n1", b: "n2", len: "500 mm", refs: "[1]" },
        { id: "s2", a: "n1", b: "n3", len: "240 mm", refs: "" },
      ],
      inlines: [{ id: "i1", seg: "s1", t: 0.5, text: "COR ø13", color: "#e8942a" }],
      tables: [
        {
          id: "t1",
          x: 40,
          y: 40,
          kind: "table",
          title: "C1 · Presa 13 poli",
          head: CAV_HEAD,
          rows: [["1", "W1", "bianco", "2.5 mm²"]],
        },
      ],
    };

    const doc = normalizeDoc(older);
    expect(doc.version).toBe(DOC_VERSION);
    expect(doc.nodes.map((n) => n.id)).toEqual(["n1", "n2", "n3"]);
    expect(doc.segments).toHaveLength(2);
    expect(doc.inlines).toHaveLength(1);
    expect(doc.tables).toHaveLength(1);
    // no title block: the meta fields still start out populated
    expect(doc.meta.title).toBe("");
    expect(doc.meta.revision).toBe("A");
    expect(doc.meta.date).not.toBe("");
    // with no `node` field the link falls back to the title
    expect(tableForNode(doc, "n2")?.id).toBe("t1");
    expect(nodeForTable(doc, doc.tables[0] as Table)?.id).toBe("n2");
  });
});

/* ---------------- connector invariant ---------------- */

describe("normalizeConnectors", () => {
  it("turns a connector the bundle passes through back into a junction", () => {
    const doc = normalizeDoc({
      nodes: [
        { id: "a", x: 0, y: 0 },
        { id: "mezzo", x: 100, y: 0, kind: "connector", name: "C1" },
        { id: "b", x: 200, y: 0 },
        { id: "capo", x: 300, y: 0, kind: "connector", name: "C2" },
      ],
      segments: [
        { id: "s1", a: "a", b: "mezzo" },
        { id: "s2", a: "mezzo", b: "b" },
        { id: "s3", a: "b", b: "capo" },
      ],
    });
    // già applicata dalla normalizzazione
    expect(findNode(doc, "mezzo")?.kind).toBe("junction");
    expect(findNode(doc, "capo")?.kind).toBe("connector");

    // and it is reversible: remove a branch and the node can be terminal again
    findNode(doc, "mezzo")!.kind = "connector";
    doc.segments = doc.segments.filter((s) => s.id !== "s2");
    normalizeConnectors(doc);
    expect(findNode(doc, "mezzo")?.kind).toBe("connector");
  });

  it("leaves a lone connector alone", () => {
    const doc = normalizeDoc({ nodes: [{ id: "solo", x: 0, y: 0, kind: "connector", name: "C1" }] });
    expect(findNode(doc, "solo")?.kind).toBe("connector");
  });
});

/* ---------------- rinomina ---------------- */

describe("renameNode", () => {
  const build = (): HarnessDoc =>
    normalizeDoc({
      nodes: [
        { id: "c13", x: 900, y: 300, kind: "connector", name: "C13" },
        { id: "cl", x: 200, y: 700, kind: "connector", name: "CL" },
        { id: "cr", x: 900, y: 700, kind: "connector", name: "CR" },
      ],
      tables: [
        {
          id: "t13",
          node: "c13",
          x: 0,
          y: 0,
          kind: "table",
          title: "C13 · Presa 13 poli",
          head: CAV_HEAD,
          rows: [
            ["1", "CL.1", "giallo", "1.5 mm²"],
            ["2", "CR.1", "verde", "1.5 mm²"],
          ],
        },
        {
          id: "tl",
          node: "cl",
          x: 0,
          y: 0,
          kind: "table",
          title: "CL",
          head: CAV_HEAD,
          rows: [
            ["1", "C13.1", "giallo", "1.5 mm²"],
            ["2", "C13.7", "nero", "1.5 mm²"],
          ],
        },
        {
          id: "tr",
          node: "cr",
          x: 0,
          y: 0,
          kind: "table",
          title: "CR · Fanale destro",
          head: CAV_HEAD,
          rows: [["1", "C13.4", "verde", "1.5 mm²"]],
        },
      ],
    });

  it("updates the table title and the cross-references, and counts them", () => {
    const doc = build();
    const node = findNode(doc, "c13")!;

    const updated = renameNode(doc, node, "C99");

    expect(updated).toBe(3);
    expect(node.name).toBe("C99");
    expect(findTable(doc, "t13")?.title).toBe("C99 · Presa 13 poli");
    expect(findTable(doc, "tl")?.rows).toEqual([
      ["1", "C99.1", "giallo", "1.5 mm²"],
      ["2", "C99.7", "nero", "1.5 mm²"],
    ]);
    expect(findTable(doc, "tr")?.rows[0]?.[1]).toBe("C99.4");
    // the tables not involved are left untouched
    expect(findTable(doc, "t13")?.rows[0]?.[1]).toBe("CL.1");
  });

  it("counts nothing when the name does not change", () => {
    const doc = build();
    expect(renameNode(doc, findNode(doc, "c13")!, "  C13  ")).toBe(0);
    expect(findTable(doc, "tl")?.rows[0]?.[1]).toBe("C13.1");
  });

  it("with an empty name it leaves the references alone, as they would break", () => {
    const doc = build();
    expect(renameNode(doc, findNode(doc, "c13")!, "")).toBe(0);
    expect(findTable(doc, "tl")?.rows[0]?.[1]).toBe("C13.1");
    expect(findNode(doc, "c13")?.name).toBe("");
  });

  it("updates the title even with no node field", () => {
    const doc = normalizeDoc({
      nodes: [{ id: "c1", x: 0, y: 0, kind: "connector", name: "C1" }],
      tables: [{ id: "t1", x: 0, y: 0, kind: "table", title: "C1 · Presa", head: CAV_HEAD, rows: [] }],
    });
    renameNode(doc, findNode(doc, "c1")!, "C2");
    expect(findTable(doc, "t1")?.title).toBe("C2 · Presa");
  });
});

/* ---------------- splitting a branch ---------------- */

describe("splitSegment", () => {
  it("redistributes the labels across the two stretches", () => {
    const doc = twoNodeDoc();
    const seg = findSegment(doc, "s1")!;
    doc.inlines.push(
      { id: "prima", seg: "s1", t: 0.2, text: "A", color: "#e8942a" },
      { id: "dopo", seg: "s1", t: 0.8, text: "B", color: "#e8942a" },
      { id: "sulTaglio", seg: "s1", t: 0.5, text: "C", color: "#e8942a" },
    );

    const mid = splitSegment(doc, seg, 0.5);

    expect(mid).not.toBeNull();
    expect(mid).toMatchObject({ x: 50, y: 0, kind: "junction" });
    expect(doc.segments).toHaveLength(2);
    expect(seg.b).toBe(mid!.id);

    const nuovo = doc.segments.find((s) => s.id !== "s1")!;
    expect(nuovo.a).toBe(mid!.id);
    expect(nuovo.b).toBe("n2");

    // the label past the cut moves to the new stretch, rescaled
    expect(inlineOf(doc, "dopo").seg).toBe(nuovo.id);
    expect(inlineOf(doc, "dopo").t).toBeCloseTo(0.6, 10);
    // the ones before the cut stay, rescaled onto the shortened stretch
    expect(inlineOf(doc, "prima").seg).toBe("s1");
    expect(inlineOf(doc, "prima").t).toBeCloseTo(0.4, 10);
    expect(inlineOf(doc, "sulTaglio").seg).toBe("s1");
    expect(inlineOf(doc, "sulTaglio").t).toBe(0.95);
  });

  it("keeps the labels within the allowed bounds", () => {
    const doc = twoNodeDoc();
    addInline(doc, "s1", 0.9, "estrema");
    splitSegment(doc, findSegment(doc, "s1")!, 0.1);
    for (const i of doc.inlines) {
      expect(i.t).toBeGreaterThanOrEqual(0.05);
      expect(i.t).toBeLessThanOrEqual(0.95);
    }
  });

  it("returns null when the segment has no valid ends", () => {
    const doc = twoNodeDoc();
    const seg = findSegment(doc, "s1")!;
    seg.b = "sparito";
    expect(splitSegment(doc, seg, 0.5)).toBeNull();
  });
});

/* ---------------- eliminazione ---------------- */

describe("deleteEntity", () => {
  const build = (): HarnessDoc =>
    normalizeDoc({
      nodes: [
        { id: "n1", x: 0, y: 0 },
        { id: "n2", x: 100, y: 0 },
        { id: "n3", x: 200, y: 0, kind: "connector", name: "C1" },
      ],
      segments: [
        { id: "s1", a: "n1", b: "n2" },
        { id: "s2", a: "n2", b: "n3" },
      ],
      inlines: [
        { id: "i1", seg: "s1", t: 0.5, text: "A" },
        { id: "i2", seg: "s2", t: 0.5, text: "B" },
      ],
      tables: [{ id: "t1", node: "n3", x: 0, y: 0, kind: "table", title: "C1", head: CAV_HEAD, rows: [] }],
    });

  it("deleting a node removes its branches, their labels and the table link", () => {
    const doc = build();
    deleteEntity(doc, "node", "n3");

    expect(findNode(doc, "n3")).toBeUndefined();
    expect(doc.segments.map((s) => s.id)).toEqual(["s1"]);
    expect(doc.inlines.map((i) => i.id)).toEqual(["i1"]);
    expect(findTable(doc, "t1")).toBeDefined();
    expect(findTable(doc, "t1")?.node).toBeUndefined();
  });

  it("deleting a branch removes its labels and any junction left isolated", () => {
    const doc = build();
    deleteEntity(doc, "segment", "s1");

    expect(findSegment(doc, "s1")).toBeUndefined();
    expect(findInline(doc, "i1")).toBeUndefined();
    expect(findInline(doc, "i2")).toBeDefined();
    // n1 is left with no branches and goes; n2 is still on s2, n3 is a connector
    expect(doc.nodes.map((n) => n.id)).toEqual(["n2", "n3"]);
  });

  it("a lone connector survives the deletion of its branch", () => {
    const doc = build();
    deleteEntity(doc, "segment", "s2");
    expect(findNode(doc, "n3")).toBeDefined();
    expect(findNode(doc, "n3")?.kind).toBe("connector");
  });

  it("deletes labels and tables without touching the rest", () => {
    const doc = build();
    deleteEntity(doc, "inline", "i1");
    expect(doc.inlines.map((i) => i.id)).toEqual(["i2"]);

    deleteEntity(doc, "table", "t1");
    expect(doc.tables).toEqual([]);
    expect(doc.nodes).toHaveLength(3);
  });

  it("ignores an unknown type or id", () => {
    const doc = build();
    deleteEntity(doc, "boh", "n1");
    deleteEntity(doc, "node", "inesistente");
    expect(doc.nodes).toHaveLength(3);
    expect(doc.segments).toHaveLength(2);
  });
});

/* ---------------- interrogazioni di supporto ---------------- */

describe("columns and names", () => {
  it("recognizes the columns from Italian and English headers", () => {
    expect(tableColumns({ id: "x", x: 0, y: 0, kind: "table", head: CAV_HEAD, rows: [] })).toEqual({
      cavity: 0,
      dest: 1,
      color: 2,
      section: 3,
    });
    expect(
      tableColumns({
        id: "x",
        x: 0,
        y: 0,
        kind: "table",
        head: ["Pin", "Goes to", "Function", "Color", "AWG"],
        rows: [],
      }),
    ).toEqual({ cavity: 0, dest: 1, func: 2, color: 3, section: 4 });
    expect(tableColumns({ id: "x", x: 0, y: 0, kind: "table", rows: [] })).toEqual({});
  });

  it("cavityTables drops tables with no cavity, destination or owner", () => {
    const doc = normalizeDoc({
      nodes: [{ id: "c1", x: 0, y: 0, kind: "connector", name: "C1" }],
      tables: [
        { id: "buona", node: "c1", x: 0, y: 0, kind: "table", head: CAV_HEAD, rows: [] },
        { id: "note", x: 0, y: 0, kind: "table", title: "Note", head: ["N.", "Nota"], rows: [] },
        { id: "cartiglio", x: 0, y: 0, kind: "title", rows: [] },
      ],
    });
    const found = cavityTables(doc);
    expect(found.map((c) => c.table.id)).toEqual(["buona"]);
    expect(found[0]?.owner).toBe("C1");
  });

  describe("mergeNodes", () => {
    /** Two junctions a hair apart, each with a branch of its own going out. */
    const twoJunctions = (): HarnessDoc =>
      normalizeDoc({
        nodes: [
          { id: "left", x: 0, y: 0, name: "" },
          { id: "right", x: 4, y: 0, name: "" },
          { id: "a", x: -100, y: 0, kind: "connector", name: "A" },
          { id: "b", x: 100, y: 0, kind: "connector", name: "B" },
        ],
        segments: [
          { id: "sa", a: "a", b: "left", len: "100 mm" },
          { id: "sb", a: "right", b: "b", len: "100 mm" },
        ],
      });

    it("moves every branch onto the survivor, which keeps its place", () => {
      const doc = twoJunctions();
      expect(mergeNodes(doc, ["left", "right"], "left")).toBe(1);
      expect(doc.nodes.map((n) => n.id)).toEqual(["left", "a", "b"]);
      expect(findNode(doc, "left")).toMatchObject({ x: 0, y: 0 });
      expect(doc.segments.map((s) => [s.a, s.b])).toEqual([
        ["a", "left"],
        ["left", "b"],
      ]);
    });

    it("drops the branch that ran between the merged nodes, and its labels", () => {
      const doc = twoJunctions();
      doc.segments.push({ id: "gap", a: "left", b: "right", len: "4 mm", refs: "" });
      addInline(doc, "gap", 0.5, "COR");
      expect(mergeNodes(doc, ["left", "right"], "left")).toBe(1);
      expect(findSegment(doc, "gap")).toBeUndefined();
      expect(doc.inlines).toHaveLength(0);
    });

    it("keeps one branch where merging would have drawn the same run twice", () => {
      const doc = normalizeDoc({
        nodes: [
          { id: "left", x: 0, y: 0 },
          { id: "right", x: 4, y: 0 },
          { id: "far", x: 100, y: 0 },
        ],
        segments: [
          { id: "s1", a: "left", b: "far", len: "100 mm" },
          { id: "s2", a: "right", b: "far", len: "99 mm" },
        ],
      });
      expect(mergeNodes(doc, ["left", "right"], "left")).toBe(1);
      expect(doc.segments.map((s) => s.id)).toEqual(["s1"]);
    });

    it("takes a name only when the survivor has none", () => {
      const doc = twoJunctions();
      const right = findNode(doc, "right")!;
      right.name = "C9";
      right.kind = "connector";
      right.style = "faston";

      const inherit = normalizeDoc(doc);
      expect(mergeNodes(inherit, ["left", "right"], "left")).toBe(1);
      expect(findNode(inherit, "left")).toMatchObject({ name: "C9", style: "faston" });

      // the other way round the name has to survive the merge just the same
      const keep = normalizeDoc(doc);
      expect(mergeNodes(keep, ["left", "right"], "right")).toBe(1);
      expect(findNode(keep, "right")?.name).toBe("C9");
    });

    it("hands the cavity table over, but never gives one connector two", () => {
      const doc = normalizeDoc({
        nodes: [
          { id: "keep", x: 0, y: 0, kind: "connector", name: "C1" },
          { id: "gone", x: 4, y: 0, kind: "connector", name: "C2" },
          { id: "third", x: 8, y: 0, kind: "connector", name: "C3" },
        ],
        tables: [
          { id: "t2", node: "gone", x: 0, y: 0, kind: "table", rows: [] },
          { id: "t3", node: "third", x: 0, y: 0, kind: "table", rows: [] },
        ],
      });
      expect(mergeNodes(doc, ["keep", "gone", "third"], "keep")).toBe(2);
      expect(findTable(doc, "t2")?.node).toBe("keep");
      expect(findTable(doc, "t3")?.node).toBeUndefined();
      expect(doc.tables).toHaveLength(2); // no table is ever thrown away
    });

    it("does nothing when there is nothing to merge", () => {
      const doc = twoJunctions();
      expect(mergeNodes(doc, ["left"], "left")).toBe(0);
      expect(mergeNodes(doc, ["left", "ghost"], "left")).toBe(0);
      expect(mergeNodes(doc, ["left", "right"], "ghost")).toBe(0);
      expect(doc.nodes).toHaveLength(4);
    });
  });

  describe("mated connectors", () => {
    /** Two harness halves, each ending in an inline connector facing the other. */
    const twoHalves = (): HarnessDoc =>
      normalizeDoc({
        nodes: [
          { id: "x", x: 100, y: 0, kind: "connector", name: "X" },
          { id: "y", x: 200, y: 0, kind: "connector", name: "Y" },
          { id: "left", x: 0, y: 0, kind: "connector", name: "L" },
          { id: "right", x: 300, y: 0, kind: "connector", name: "R" },
        ],
        segments: [
          { id: "sl", a: "left", b: "x", len: "100 mm" },
          { id: "sr", a: "y", b: "right", len: "100 mm" },
        ],
      });

    it("mates both ways at once and only once", () => {
      const doc = twoHalves();
      expect(mateConnectors(doc, "x", "y")).toBe(true);
      expect(findNode(doc, "x")?.mate).toBe("y");
      expect(findNode(doc, "y")?.mate).toBe("x");
      expect(mateOf(doc, "x")?.id).toBe("y");
      // asking again changes nothing, so it cannot make an undo step of its own
      expect(mateConnectors(doc, "x", "y")).toBe(false);
    });

    it("leaves the previous partner free rather than making a triangle", () => {
      const doc = twoHalves();
      mateConnectors(doc, "x", "y");
      mateConnectors(doc, "x", "right");
      expect(findNode(doc, "y")?.mate).toBeUndefined();
      expect(findNode(doc, "right")?.mate).toBe("x");
    });

    it("refuses a node the bundle runs through", () => {
      const doc = twoHalves();
      doc.segments.push({ id: "extra", a: "x", b: "right", len: "", refs: "" });
      expect(mateConnectors(doc, "x", "y")).toBe(false);
      expect(findNode(doc, "x")?.mate).toBeUndefined();
    });

    it("drops a link the other end does not return", () => {
      const doc = twoHalves();
      findNode(doc, "x")!.mate = "y";
      normalizeMates(doc);
      expect(findNode(doc, "x")?.mate).toBeUndefined();
    });

    it("survives being written into a file and read back", () => {
      const doc = twoHalves();
      mateConnectors(doc, "x", "y");
      const reopened = normalizeDoc(JSON.parse(JSON.stringify(doc)));
      expect(findNode(reopened, "x")?.mate).toBe("y");
      expect(findNode(reopened, "y")?.mate).toBe("x");
    });

    it("lets go when the connector on the other side is deleted", () => {
      const doc = twoHalves();
      mateConnectors(doc, "x", "y");
      deleteEntity(doc, "node", "y");
      expect(findNode(doc, "x")?.mate).toBeUndefined();
    });

    it("unmates from either side", () => {
      const doc = twoHalves();
      mateConnectors(doc, "x", "y");
      expect(unmateConnector(doc, "y")).toBe(true);
      expect(findNode(doc, "x")?.mate).toBeUndefined();
      expect(unmateConnector(doc, "y")).toBe(false);
    });

    it("hands the joint to the survivor of a merge", () => {
      const doc = twoHalves();
      mateConnectors(doc, "x", "y");
      // "left" absorbs x, and the joint has to come with it
      mergeNodes(doc, ["left", "x"], "left");
      expect(findNode(doc, "left")?.mate).toBe("y");
      expect(findNode(doc, "y")?.mate).toBe("left");
    });
  });

  describe("bends and squaring", () => {
    /** One branch, both ends off the same axis so there is a corner to make. */
    const oneBranch = (square: boolean): HarnessDoc =>
      normalizeDoc({
        square,
        nodes: [
          { id: "a", x: 0, y: 0, kind: "connector", name: "A" },
          { id: "b", x: 300, y: 100, kind: "connector", name: "B" },
        ],
        segments: [{ id: "s", a: "a", b: "b", len: "300 mm" }],
      });

    it("runs straight when the drawing is not square", () => {
      const doc = oneBranch(false);
      expect(segmentPath(doc, doc.segments[0]!)!).toHaveLength(2);
    });

    it("crosses over exactly halfway, along the longer axis first", () => {
      const doc = oneBranch(true);
      // 300 across against 100 down: out along x, across at the midpoint, on again
      expect(segmentPath(doc, doc.segments[0]!)!).toEqual([
        { x: 0, y: 0 },
        { x: 150, y: 0 },
        { x: 150, y: 100 },
        { x: 300, y: 100 },
      ]);
    });

    it("takes the other axis when flipped, still crossing over in the middle", () => {
      const doc = oneBranch(true);
      doc.segments[0]!.flip = true;
      expect(segmentPath(doc, doc.segments[0]!)!).toEqual([
        { x: 0, y: 0 },
        { x: 0, y: 50 },
        { x: 300, y: 50 },
        { x: 300, y: 100 },
      ]);
    });

    it("follows a connector that has been told where to point", () => {
      const doc = oneBranch(true);
      // 300 across against 100 down, so left alone it goes out horizontally
      expect(segmentPath(doc, doc.segments[0]!)![1]).toEqual({ x: 150, y: 0 });
      findNode(doc, "a")!.facing = "up";
      expect(segmentPath(doc, doc.segments[0]!)![1]).toEqual({ x: 0, y: 50 });
      // the far end can say it just as well
      delete findNode(doc, "a")!.facing;
      findNode(doc, "b")!.facing = "down";
      expect(segmentPath(doc, doc.segments[0]!)![1]).toEqual({ x: 0, y: 50 });
    });

    it("keeps a facing across a save, and refuses one that means nothing", () => {
      const doc = oneBranch(true);
      findNode(doc, "a")!.facing = "left";
      const reopened = normalizeDoc(JSON.parse(JSON.stringify(doc)));
      expect(findNode(reopened, "a")?.facing).toBe("left");

      const nonsense = normalizeDoc({ nodes: [{ id: "a", x: 0, y: 0, facing: "sideways" }] });
      expect(findNode(nonsense, "a")?.facing).toBeUndefined();
    });

    it("leaves both ends along the same axis, which is what the crossover costs", () => {
      const doc = oneBranch(true);
      const path = segmentPath(doc, doc.segments[0]!)!;
      expect(path[0]!.y).toBe(path[1]!.y); // horizontal out of A
      expect(path[2]!.y).toBe(path[3]!.y); // and horizontal into B
    });

    it("makes no corner for ends that already line up", () => {
      const doc = oneBranch(true);
      findNode(doc, "b")!.y = 0;
      expect(segmentPath(doc, doc.segments[0]!)!).toHaveLength(2);
    });

    it("aims the run so the cable leaves a node the way asked", () => {
      const doc = oneBranch(true);
      faceNode(doc, "a", false); // A's cable is to come out vertically
      expect(segmentPath(doc, doc.segments[0]!)![1]).toEqual({ x: 0, y: 50 });
      faceNode(doc, "a", true);
      expect(segmentPath(doc, doc.segments[0]!)![1]).toEqual({ x: 150, y: 0 });
      // both ends share the axis now, so aiming either one aims the run
      faceNode(doc, "b", false);
      expect(segmentPath(doc, doc.segments[0]!)![1]).toEqual({ x: 0, y: 50 });
    });

    it("leaves a branch bent by hand alone", () => {
      const doc = oneBranch(true);
      doc.segments[0]!.points = [{ x: 50, y: 90 }];
      faceNode(doc, "a", false);
      expect(doc.segments[0]!.flip).toBeUndefined();
      expect(segmentPath(doc, doc.segments[0]!)![1]).toEqual({ x: 50, y: 90 });
    });

    it("puts a bend on the leg it was asked for, keeping the order", () => {
      const doc = oneBranch(false);
      const seg = doc.segments[0]!;
      addBend(doc, seg, { x: 200, y: 66 });
      addBend(doc, seg, { x: 100, y: 33 });
      expect(seg.points).toEqual([
        { x: 100, y: 33 },
        { x: 200, y: 66 },
      ]);
    });

    it("drops the field once the last bend goes", () => {
      const doc = oneBranch(false);
      const seg = doc.segments[0]!;
      addBend(doc, seg, { x: 150, y: 50 });
      expect(removeBend(seg, 0)).toBe(true);
      expect(seg.points).toBeUndefined();
      expect(removeBend(seg, 0)).toBe(false);
    });

    it("survives being written into a file and read back", () => {
      const doc = oneBranch(false);
      doc.segments[0]!.points = [{ x: 10, y: 20 }];
      const reopened = normalizeDoc(JSON.parse(JSON.stringify(doc)));
      expect(reopened.segments[0]!.points).toEqual([{ x: 10, y: 20 }]);
    });

    it("shares the bends out when the branch is split", () => {
      const doc = oneBranch(false);
      const seg = doc.segments[0]!;
      // an L up and over: 100 up, 300 across, 100 down, cut halfway along
      seg.points = [
        { x: 0, y: -100 },
        { x: 300, y: -100 },
      ];
      const mid = splitSegment(doc, seg, 0.5);
      expect(mid).not.toBeNull();
      expect(seg.points).toEqual([{ x: 0, y: -100 }]);
      expect(doc.segments[1]!.points).toEqual([{ x: 300, y: -100 }]);
    });
  });

  it("nextName finds the first free name with the prefix", () => {
    const doc = normalizeDoc({
      nodes: [
        { id: "a", x: 0, y: 0, kind: "connector", name: "C1" },
        { id: "b", x: 0, y: 0, kind: "connector", name: "C2" },
        { id: "c", x: 0, y: 0, kind: "connector", name: "C4" },
      ],
    });
    expect(nextName(doc, "C")).toBe("C3");
    expect(nextName(doc, "W")).toBe("W1");
  });
});
