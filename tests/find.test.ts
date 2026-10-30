import { describe, expect, it } from "vitest";
import { normalizeDoc } from "@/core/doc";
import {
  DEFAULT_FIND_OPTIONS,
  cellKey,
  findAll,
  matches,
  replaceAll,
  replaceAt,
  replaceInText,
  textOf,
} from "@/core/find";
import type { FindOptions } from "@/core/find";
import type { HarnessDoc } from "@/core/types";

const HEAD = ["Cavity", "To", "Function", "Colour"];

const harness = (): HarnessDoc =>
  normalizeDoc({
    meta: { title: "Opel GT", company: "Dyal Garage" },
    nodes: [
      { id: "a", x: 0, y: 0, kind: "connector", name: "A" },
      { id: "j", x: 100, y: 0, kind: "junction", name: "" },
      { id: "b", x: 200, y: 0, kind: "connector", name: "B" },
    ],
    segments: [
      { id: "s1", a: "a", b: "j", len: "400 mm" },
      { id: "s2", a: "j", b: "b", len: "600 mm" },
    ],
    inlines: [{ id: "i1", seg: "s1", t: 0.5, text: "Main feed", color: "#ffffff" }],
    tables: [
      {
        id: "ta",
        x: 0,
        y: 0,
        kind: "table",
        node: "a",
        title: "A — Headlights",
        head: HEAD,
        rows: [
          ["1", "B.1", "Low beam", "Red"],
          ["2", "B.2", "High beam", "red/white"],
        ],
      },
      {
        id: "tb",
        x: 0,
        y: 0,
        kind: "table",
        node: "b",
        title: "B — Fuse panel",
        head: HEAD,
        rows: [
          ["1", "A.1", "Low beam", "Red"],
          ["2", "A.2", "High beam", "red/white"],
        ],
      },
    ],
  });

const opt = (o: Partial<FindOptions> = {}): FindOptions => ({ ...DEFAULT_FIND_OPTIONS, ...o });

describe("matches", () => {
  it("ignores case unless asked not to", () => {
    expect(matches("Low Beam", "low beam", opt())).toBe(true);
    expect(matches("Low Beam", "low beam", opt({ matchCase: true }))).toBe(false);
  });

  it("looks for the query inside the text, or for the whole text", () => {
    expect(matches("High beam", "beam", opt())).toBe(true);
    expect(matches("High beam", "beam", opt({ whole: true }))).toBe(false);
    expect(matches(" beam ", "beam", opt({ whole: true }))).toBe(true);
  });

  it("matches nothing for an empty query", () => {
    expect(matches("anything", "", opt())).toBe(false);
  });
});

describe("replaceInText", () => {
  it("replaces every occurrence, whatever its case", () => {
    expect(replaceInText("Red and RED", "red", "Blue", opt())).toBe("Blue and Blue");
  });

  it("treats the query and the replacement as plain text", () => {
    expect(replaceInText("a.b a+b", "a.b", "$&", opt())).toBe("$& a+b");
    expect(replaceInText("1 mm²", "mm²", "mm2", opt())).toBe("1 mm2");
  });

  it("swaps a whole text for the replacement", () => {
    expect(replaceInText("Red", "red", "Blue", opt({ whole: true }))).toBe("Blue");
    expect(replaceInText("Red/white", "red", "Blue", opt({ whole: true }))).toBe("Red/white");
  });
});

describe("findAll", () => {
  it("finds cells, headings and titles in table order", () => {
    const hits = findAll(harness(), "beam", opt());
    expect(hits.map((h) => h.kind)).toEqual(["cell", "cell", "cell", "cell"]);
    expect(hits[0]).toEqual({ kind: "cell", table: "ta", row: 0, col: 2 });
  });

  it("finds connector names, branch lengths, labels and title block fields", () => {
    const doc = harness();
    expect(findAll(doc, "400", opt()).map((h) => h.kind)).toEqual(["length"]);
    expect(findAll(doc, "feed", opt()).map((h) => h.kind)).toEqual(["label"]);
    expect(findAll(doc, "garage", opt()).map((h) => h.kind)).toEqual(["meta"]);
    expect(findAll(doc, "Headlights", opt()).map((h) => h.kind)).toEqual(["title"]);
    expect(findAll(doc, "Cavity", opt()).map((h) => h.kind)).toEqual(["head", "head"]);
    // the title block's revision also reads "A": it is text like any other
    const kinds = findAll(doc, "A", opt({ whole: true, matchCase: true })).map((h) => h.kind);
    expect(kinds).toEqual(["connector", "meta"]);
  });

  it("does not list junctions, which have no name", () => {
    expect(findAll(harness(), "", opt())).toEqual([]);
    expect(findAll(harness(), "j", opt({ whole: true })).filter((h) => h.kind === "connector")).toEqual([]);
  });

  it("keys the targets that sit in a table", () => {
    expect(cellKey({ kind: "cell", table: "ta", row: 1, col: 3 })).toBe("r:1:3");
    expect(cellKey({ kind: "head", table: "ta", col: 2 })).toBe("h:2");
    expect(cellKey({ kind: "title", table: "ta" })).toBe("t");
    expect(cellKey({ kind: "length", segment: "s1" })).toBeNull();
  });
});

describe("replaceAt", () => {
  it("changes one cell and nothing else", () => {
    const doc = harness();
    const target = { kind: "cell", table: "ta", row: 0, col: 2 } as const;
    expect(replaceAt(doc, target, "low", "Dipped", opt())).toBe(true);
    expect(textOf(doc, target)).toBe("Dipped beam");
    expect(doc.tables[1]?.rows[0]?.[2]).toBe("Low beam");
  });

  it("reports no change when the text does not contain the query", () => {
    const doc = harness();
    expect(replaceAt(doc, { kind: "cell", table: "ta", row: 0, col: 0 }, "zzz", "x", opt())).toBe(false);
  });
});

describe("replaceAll", () => {
  it("replaces in every table and counts the places changed", () => {
    const doc = harness();
    expect(replaceAll(doc, "beam", "lamp", opt())).toEqual({ changed: 4, held: 0 });
    expect(doc.tables[0]?.rows[0]?.[2]).toBe("Low lamp");
    expect(doc.tables[1]?.rows[1]?.[2]).toBe("High lamp");
  });

  it("renames a connector once, with its references and its table title", () => {
    const doc = harness();
    replaceAll(doc, "A", "ALT", opt({ whole: true, matchCase: true }));
    expect(doc.nodes[0]?.name).toBe("ALT");
    expect(doc.tables[0]?.title).toBe("ALT — Headlights");
    // the other connector's references to it follow, as the whole text "A.1" is not "A"
    expect(doc.tables[1]?.rows[0]?.[1]).toBe("ALT.1");
  });

  it("does not rewrite a reference twice when the new name contains the old one", () => {
    const doc = harness();
    replaceAll(doc, "A", "AA", opt({ whole: true, matchCase: true }));
    expect(doc.nodes[0]?.name).toBe("AA");
    expect(doc.tables[0]?.title).toBe("AA — Headlights");
    expect(doc.tables[1]?.rows[0]?.[1]).toBe("AA.1");
  });

  it("does not rewrite a reference twice when the name contains the old one and the match is not whole", () => {
    const doc = harness();
    // "A" is also a bare part of "A.1", "A.2" and the title: the rename has done those already
    replaceAll(doc, "A", "AX", opt({ whole: false, matchCase: true }));
    expect(doc.nodes[0]?.name).toBe("AX");
    expect(doc.tables[0]?.title).toBe("AX — Headlights");
    expect(doc.tables[1]?.rows[0]?.[1]).toBe("AX.1");
    expect(doc.tables[1]?.rows[1]?.[1]).toBe("AX.2");
  });

  it("counts the references a rename carried along as places changed", () => {
    const doc = harness();
    // the connector, its table title and the two cells that point at it, and the
    // revision, which is "A" by default and is not about the connector
    const result = replaceAll(doc, "A", "ALT", opt({ whole: true, matchCase: true }));
    expect(result).toEqual({ changed: 5, held: 0 });
  });

  it("refuses to give a connector the name another one has", () => {
    const doc = harness();
    replaceAll(doc, "A", "B", opt({ whole: true, matchCase: true }));
    expect(doc.nodes[0]?.name).toBe("A");
    expect(doc.tables[0]?.title).toBe("A — Headlights");
  });

  it("leaves the references to a connector alone when its rename is refused", () => {
    const doc = harness();
    // "A" is not a whole cell here, so the A.1 and A.2 cells and the table title match too
    const result = replaceAll(doc, "A", "B", opt({ matchCase: true }));
    expect(doc.nodes[0]?.name).toBe("A");
    expect(doc.tables[0]?.title).toBe("A — Headlights");
    expect(doc.tables[1]?.rows[0]?.[1]).toBe("A.1");
    expect(doc.tables[1]?.rows[1]?.[1]).toBe("A.2");
    // the one place that changed is the revision, "A" by default, which is not the connector
    expect(doc.meta.revision).toBe("B");
    expect(result).toEqual({ changed: 1, held: 4 });
  });

  it("still replaces the text that is not about the connector that was refused", () => {
    const doc = harness();
    const result = replaceAll(doc, "e", "E", opt({ matchCase: true, whole: false }));
    expect(result.held).toBe(0);
    expect(doc.tables[0]?.rows[0]?.[2]).toBe("Low bEam");
  });

  it("changes the title block fields", () => {
    const doc = harness();
    replaceAll(doc, "Opel GT", "Opel GT 1970", opt());
    expect(doc.meta.title).toBe("Opel GT 1970");
  });
});

/** Two injectors whose tables are tied to them by their titles alone, as a drawing from a file is. */
const injectors = (): HarnessDoc =>
  normalizeDoc({
    nodes: [
      { id: "n2", x: 0, y: 0, kind: "connector", name: "INJ2" },
      { id: "n3", x: 100, y: 0, kind: "connector", name: "INJ3" },
    ],
    segments: [{ id: "s", a: "n2", b: "n3", len: "300 mm" }],
    tables: [
      {
        id: "t2",
        x: 0,
        y: 0,
        kind: "table",
        title: "INJ2 — Injector 2",
        head: HEAD,
        rows: [["1", "INJ3.1", "Fuel", "Red"]],
      },
      {
        id: "t3",
        x: 0,
        y: 0,
        kind: "table",
        title: "INJ3 — Injector 3",
        head: HEAD,
        rows: [["1", "INJ2.1", "Fuel", "Red"]],
      },
    ],
  });

describe("table titles", () => {
  it("leaves a connector's table alone when the connector cannot take the new name", () => {
    const doc = injectors();
    const result = replaceAll(doc, "INJ2", "INJ3", opt());
    expect(doc.nodes[0]?.name).toBe("INJ2");
    expect(doc.tables[0]?.title).toBe("INJ2 — Injector 2");
    expect(doc.tables[1]?.rows[0]?.[1]).toBe("INJ2.1");
    expect(result.changed).toBe(0);
    expect(result.held).toBeGreaterThan(0);
  });

  it("refuses a title that gives two tables the same name", () => {
    const doc = injectors();
    expect(replaceAt(doc, { kind: "title", table: "t3" }, "Injector 3", "Injector 2", opt())).toBe(true);
    expect(replaceAt(doc, { kind: "title", table: "t3" }, "INJ3", "INJ2", opt())).toBe(false);
    expect(doc.tables[1]?.title).toBe("INJ3 — Injector 2");
  });

  it("refuses a title that stops starting with the connector's name", () => {
    const doc = injectors();
    expect(replaceAt(doc, { kind: "title", table: "t2" }, "INJ2", "FUEL", opt())).toBe(false);
    expect(doc.tables[0]?.title).toBe("INJ2 — Injector 2");
  });

  it("still renames the connector and its table together when the name is free", () => {
    const doc = injectors();
    replaceAll(doc, "INJ2", "INJ9", opt());
    expect(doc.nodes[0]?.name).toBe("INJ9");
    expect(doc.tables[0]?.title).toBe("INJ9 — Injector 2");
    expect(doc.tables[1]?.rows[0]?.[1]).toBe("INJ9.1");
  });
});
