import { describe, expect, it } from "vitest";
import {
  addEntry,
  catalogOf,
  contactGenders,
  fitCavityRows,
  housingCavities,
  namesATermination,
  nameIsFree,
  removeEntry,
  renameEntry,
  symbolFor,
  syncCatalogs,
  totalUsage,
  usageOf,
} from "@/core/catalog";
import {
  cavityTables,
  isCavityTable,
  isOrphanTable,
  normalizeDoc,
  ownerName,
  spliceNode,
  tableColumns,
} from "@/core/doc";
import { cavityTable, catalogTable, notesTable, revisionsTable, wireListHeadings } from "@/core/factories";
import { Store } from "@/core/store";
import { validateDoc } from "@/core/validate";
import { en } from "@/i18n/en";
import { it as italian } from "@/i18n/it";
import type { HarnessDoc, Table } from "@/core/types";

const t = (key: string, params: Record<string, string | number> = {}): string =>
  ((en as Record<string, string>)[key] ?? key).replace(/\{(\w+)\}/g, (_, k: string) =>
    String(params[k] ?? ""),
  );

const housings = (): Table => ({
  id: "th",
  x: 0,
  y: 0,
  kind: "housings",
  title: "Housings",
  head: ["Name", "#", "PN", "Maker", "Series", "Form", "Desc", "Qty", "Where"],
  rows: [
    ["Multi-pin", "", "", "", "", "", "", "", ""],
    ["DIN", "5", "", "", "", "", "", "", ""],
  ],
  symbols: { "Multi-pin": "plug", DIN: "round" },
});

const terminations = (): Table => ({
  id: "tt",
  x: 0,
  y: 0,
  kind: "terminations",
  title: "Terminations",
  head: ["Type", "PN", "Maker", "Desc", "Qty", "Where"],
  rows: [
    ["Ring terminal", "", "", "", "", ""],
    ["Faston 6.3", "", "", "", "", ""],
    ["Faston 2.8", "", "", "", "", ""],
  ],
  symbols: { "Ring terminal": "ring", "Faston 6.3": "faston", "Faston 2.8": "faston" },
});

/** A connector C1 and C2, each with a cavity table with a Termination column. */
const drawing = (extra: Partial<HarnessDoc> = {}): HarnessDoc =>
  normalizeDoc({
    nodes: [
      { id: "n1", x: 0, y: 0, kind: "connector", name: "C1", style: "plug" },
      { id: "n2", x: 100, y: 0, kind: "connector", name: "C2", style: "plug" },
    ],
    segments: [{ id: "s1", a: "n1", b: "n2", len: "", refs: "" }],
    tables: [
      housings(),
      terminations(),
      {
        id: "c1",
        node: "n1",
        x: 0,
        y: 0,
        kind: "table",
        title: "C1",
        housing: "multi-pin",
        head: ["Cavity", "Termination", "Dest", "PIN"],
        rows: [
          ["1", "Faston 6.3", "", ""],
          ["2", "Faston 6.3", "", ""],
          ["3", "Faston 2.8", "", ""],
        ],
      },
      {
        id: "c2",
        node: "n2",
        x: 0,
        y: 0,
        kind: "table",
        title: "C2",
        housing: "DIN",
        head: ["Cavity", "Termination", "Dest", "PIN"],
        rows: [["1", "Faston 6.3", "", ""]],
      },
    ],
    ...extra,
  });

const row = (table: Table | undefined, name: string): string[] =>
  table?.rows.find((r) => r[0] === name) ?? [];

describe("reading a drawing with catalogues", () => {
  it("keeps the housing and termination tables, with their symbols", () => {
    const doc = drawing();
    expect(catalogOf(doc, "housings")?.symbols).toEqual({ "Multi-pin": "plug", DIN: "round" });
    expect(catalogOf(doc, "terminations")?.rows).toHaveLength(3);
  });

  it("keeps one of each, and the first", () => {
    const doc = normalizeDoc({
      tables: [housings(), { ...housings(), id: "again" }, terminations(), { ...terminations(), id: "more" }],
    });
    expect(doc.tables.map((tb) => tb.id)).toEqual(["th", "tt"]);
  });

  it("pads the rows to the columns of the catalogue", () => {
    const doc = normalizeDoc({
      tables: [{ id: "x", x: 0, y: 0, kind: "housings", rows: [["Short"]] }],
    });
    expect(doc.tables[0]?.rows[0]).toHaveLength(9);
  });

  it("drops a housing the housing table does not have, and spells the one it has as the table does", () => {
    const doc = drawing();
    expect(doc.tables.find((tb) => tb.id === "c1")?.housing).toBe("Multi-pin");

    const orphan = normalizeDoc({
      tables: [
        housings(),
        { id: "c", x: 0, y: 0, kind: "table", title: "C", housing: "Gone", rows: [] },
        { id: "d", x: 0, y: 0, kind: "table", title: "D", housing: "DIN", rows: [] },
      ],
    });
    expect(orphan.tables.find((tb) => tb.id === "c")?.housing).toBeUndefined();
    expect(orphan.tables.find((tb) => tb.id === "d")?.housing).toBe("DIN");
  });

  it("has no housing at all when there is no housing table", () => {
    const doc = normalizeDoc({
      tables: [{ id: "c", x: 0, y: 0, kind: "table", title: "C", housing: "DIN", rows: [] }],
    });
    expect(doc.tables[0]?.housing).toBeUndefined();
  });

  it("does not let an ordinary table claim a housing or a symbol map it has no use for", () => {
    const doc = normalizeDoc({
      tables: [{ id: "n", x: 0, y: 0, kind: "table", title: "Notes", symbols: { a: "b" }, rows: [] }],
    });
    expect(doc.tables[0]?.symbols).toBeUndefined();
  });
});

describe("the columns that are worked out", () => {
  it("counts the connectors that use a housing, and names them", () => {
    const doc = drawing();
    const table = catalogOf(doc, "housings");
    expect(row(table, "Multi-pin").slice(7)).toEqual(["1", "C1"]);
    expect(row(table, "DIN").slice(7)).toEqual(["1", "C2"]);
  });

  it("counts the cavities that use a termination, and names each connector once", () => {
    const table = catalogOf(drawing(), "terminations");
    expect(row(table, "Faston 6.3").slice(4)).toEqual(["3", "C1, C2"]);
    expect(row(table, "Faston 2.8").slice(4)).toEqual(["1", "C1"]);
    expect(row(table, "Ring terminal").slice(4)).toEqual(["0", ""]);
  });

  it("follows a housing being reassigned", () => {
    const doc = drawing();
    const c1 = doc.tables.find((tb) => tb.id === "c1");
    if (c1) c1.housing = "DIN";
    syncCatalogs(doc);
    const table = catalogOf(doc, "housings");
    expect(row(table, "Multi-pin").slice(7)).toEqual(["0", ""]);
    expect(row(table, "DIN").slice(7)).toEqual(["2", "C1, C2"]);
  });

  it("ignores a termination written in a cavity that the table does not have, and leaves it alone", () => {
    const doc = drawing();
    const c1 = doc.tables.find((tb) => tb.id === "c1");
    if (c1?.rows[0]) c1.rows[0][1] = "Something typed";
    syncCatalogs(doc);
    expect(c1?.rows[0]?.[1]).toBe("Something typed");
    expect(row(catalogOf(doc, "terminations"), "Faston 6.3").slice(4)).toEqual(["2", "C1, C2"]);
  });

  it("matches names without regard to case or padding", () => {
    const doc = drawing();
    const c1 = doc.tables.find((tb) => tb.id === "c1");
    if (c1?.rows[2]) c1.rows[2][1] = "  faston 2.8 ";
    expect(usageOf(doc, "terminations", "Faston 2.8").count).toBe(1);
  });

  it("keeps up through the store: assigning and unassigning updates the table the same edit", () => {
    const store = new Store();
    store.load(drawing());
    store.edit((doc) => {
      const c2 = doc.tables.find((tb) => tb.id === "c2");
      if (c2) c2.housing = "Multi-pin";
    });
    expect(row(catalogOf(store.doc, "housings"), "Multi-pin").slice(7)).toEqual(["2", "C1, C2"]);
    store.undo();
    expect(row(catalogOf(store.doc, "housings"), "Multi-pin").slice(7)).toEqual(["1", "C1"]);
  });
});

describe("how a connector is drawn", () => {
  it("takes the symbol of its housing", () => {
    const doc = drawing();
    expect(doc.nodes.find((n) => n.id === "n2")?.style).toBe("round");
    expect(doc.nodes.find((n) => n.id === "n1")?.style).toBe("plug");
  });

  it("takes the symbol of its first known termination when it has no housing", () => {
    const doc = drawing();
    const c1 = doc.tables.find((tb) => tb.id === "c1");
    if (c1) {
      delete c1.housing;
      c1.rows = [
        ["1", "Nothing", "", ""],
        ["2", "Ring terminal", "", ""],
      ];
    }
    syncCatalogs(doc);
    expect(c1 && symbolFor(doc, c1)).toBe("ring");
    expect(doc.nodes.find((n) => n.id === "n1")?.style).toBe("ring");
  });

  it("leaves a connector alone when its table says nothing", () => {
    const doc = drawing();
    const c1 = doc.tables.find((tb) => tb.id === "c1");
    if (c1) {
      delete c1.housing;
      c1.rows = [["1", "", "", ""]];
    }
    const node = doc.nodes.find((n) => n.id === "n1");
    if (node) node.style = "faston";
    syncCatalogs(doc);
    expect(node?.style).toBe("faston");
  });

  it("never turns a splice into something else", () => {
    const doc = drawing();
    const node = doc.nodes.find((n) => n.id === "n1");
    if (node) node.style = "splice";
    syncCatalogs(doc);
    expect(node?.style).toBe("splice");
  });

  it("uses a generic symbol for an entry that has none", () => {
    const doc = drawing();
    const table = catalogOf(doc, "housings");
    if (table) delete table.symbols;
    syncCatalogs(doc);
    expect(doc.nodes.find((n) => n.id === "n2")?.style).toBe("plug");
  });
});

describe("adding", () => {
  it("adds an entry with its symbol, counting nothing yet", () => {
    const doc = drawing();
    const table = catalogOf(doc, "terminations") as Table;
    const at = addEntry(table, { name: "Blade 9.5", partNumber: "X1" }, "faston");
    expect(at).toBe(3);
    expect(table.rows[at]).toEqual(["Blade 9.5", "X1", "", "", "0", ""]);
    expect(table.symbols?.["Blade 9.5"]).toBe("faston");
  });

  it("will not add a name that is empty or already there, whatever the case", () => {
    const table = catalogOf(drawing(), "housings") as Table;
    expect(addEntry(table, { name: "  " })).toBe(-1);
    expect(addEntry(table, { name: "din" })).toBe(-1);
    expect(nameIsFree(table, "din")).toBe(false);
    expect(nameIsFree(table, "din", 1)).toBe(true);
    expect(table.rows).toHaveLength(2);
  });
});

describe("renaming", () => {
  it("takes the cavity tables along, so nothing names what is gone", () => {
    const doc = drawing();
    const table = catalogOf(doc, "terminations") as Table;
    const at = table.rows.findIndex((r) => r[0] === "Faston 6.3");
    const before = table.rows[at]?.[0] ?? "";
    if (table.rows[at]) table.rows[at][0] = "Faston 6.35";
    renameEntry(doc, table, before, "Faston 6.35");
    syncCatalogs(doc);
    expect(doc.tables.find((tb) => tb.id === "c1")?.rows[0]?.[1]).toBe("Faston 6.35");
    expect(row(table, "Faston 6.35").slice(4)).toEqual(["3", "C1, C2"]);
    expect(table.symbols?.["Faston 6.35"]).toBe("faston");
    expect(table.symbols?.["Faston 6.3"]).toBeUndefined();
  });

  it("takes a housing along too", () => {
    const doc = drawing();
    const table = catalogOf(doc, "housings") as Table;
    if (table.rows[1]) table.rows[1][0] = "DIN 5-pin";
    renameEntry(doc, table, "DIN", "DIN 5-pin");
    syncCatalogs(doc);
    expect(doc.tables.find((tb) => tb.id === "c2")?.housing).toBe("DIN 5-pin");
    expect(doc.nodes.find((n) => n.id === "n2")?.style).toBe("round");
  });
});

describe("deleting", () => {
  it("says how much depends on an entry, before anything is changed", () => {
    const doc = drawing();
    expect(usageOf(doc, "housings", "Multi-pin")).toEqual({ count: 1, owners: ["C1"] });
    expect(usageOf(doc, "terminations", "Faston 6.3")).toEqual({ count: 3, owners: ["C1", "C2"] });
    expect(usageOf(doc, "terminations", "Ring terminal")).toEqual({ count: 0, owners: [] });
  });

  it("lets go of what used a housing, and says what it let go of", () => {
    const doc = drawing();
    const table = catalogOf(doc, "housings") as Table;
    const gone = removeEntry(doc, table, 0);
    syncCatalogs(doc);
    expect(gone).toEqual({ count: 1, owners: ["C1"] });
    expect(table.rows.map((r) => r[0])).toEqual(["DIN"]);
    expect(doc.tables.find((tb) => tb.id === "c1")?.housing).toBeUndefined();
    expect(doc.tables.find((tb) => tb.id === "c2")?.housing).toBe("DIN");
    expect(table.symbols).toEqual({ DIN: "round" });
  });

  it("empties the cavities that used a termination, and only those", () => {
    const doc = drawing();
    const table = catalogOf(doc, "terminations") as Table;
    const gone = removeEntry(doc, table, 1);
    syncCatalogs(doc);
    expect(gone.count).toBe(3);
    const c1 = doc.tables.find((tb) => tb.id === "c1");
    expect(c1?.rows.map((r) => r[1])).toEqual(["", "", "Faston 2.8"]);
    expect(doc.tables.find((tb) => tb.id === "c2")?.rows[0]?.[1]).toBe("");
  });

  it("can be asked for the whole of a catalogue", () => {
    const doc = drawing();
    expect(totalUsage(doc, "housings")).toEqual({ count: 2, owners: ["C1", "C2"] });
    expect(totalUsage(doc, "terminations").count).toBe(4);
  });

  it("leaves no housing behind when the whole housing table goes", () => {
    const doc = drawing();
    doc.tables = doc.tables.filter((tb) => tb.kind !== "housings");
    syncCatalogs(doc);
    expect(doc.tables.every((tb) => tb.housing === undefined)).toBe(true);
  });
});

describe("the tables a new drawing is given", () => {
  it("starts a catalogue from the entries it is handed, each with its symbol", () => {
    const table = catalogTable(t, "terminations", 5, 6, [
      { name: "Ring", symbol: "ring" },
      { name: "Faston", symbol: "faston" },
    ]);
    expect(table.kind).toBe("terminations");
    expect(table.rows.map((r) => r[0])).toEqual(["Ring", "Faston"]);
    expect(table.rows.every((r) => r.length === table.head?.length)).toBe(true);
    expect(table.symbols).toEqual({ Ring: "ring", Faston: "faston" });
    expect(table).toMatchObject({ x: 5, y: 6 });
  });

  it("has a housing table with the nine columns that were asked for", () => {
    const table = catalogTable(t, "housings", 0, 0);
    expect(table.head).toHaveLength(9);
    expect(table.head?.slice(-2)).toEqual(["Quantity", "Where Used"]);
  });

  it("gives a cavity table a termination column that is recognised as such", () => {
    const cols = tableColumns(cavityTable(t, 0, 0));
    expect(cols.termination).toBeDefined();
    expect(cols.cavity).toBe(0);
    expect(cols.dest).toBeDefined();
  });
});

describe("the termination column", () => {
  const cols = (head: string[]) => tableColumns({ id: "x", x: 0, y: 0, kind: "table", head, rows: [] });

  it("is found by its heading, in either language, and is not mistaken for the cavity", () => {
    expect(cols(["Cavity", "Termination"]).termination).toBe(1);
    expect(cols(["Cavità", "Terminazione"]).termination).toBe(1);
    expect(cols(["Cavity", "Termination"]).cavity).toBe(0);
  });

  it("is not there when the table has none", () => {
    expect(cols(["Cavity", "Colour", "Dest"]).termination).toBeUndefined();
  });
});

describe("a housing's cavities", () => {
  it("reads the count from the housing table, and nothing from a blank or a word", () => {
    const doc = drawing();
    expect(housingCavities(doc, "DIN")).toBe(5);
    expect(housingCavities(doc, "din")).toBe(5);
    expect(housingCavities(doc, "Multi-pin")).toBeUndefined();
    expect(housingCavities(doc, "Nothing")).toBeUndefined();
    const table = catalogOf(doc, "housings");
    if (table?.rows[1]) table.rows[1][1] = "many";
    expect(housingCavities(doc, "DIN")).toBeUndefined();
  });

  const cavityRows = (n: number): string[][] =>
    Array.from({ length: n }, (_, i) => [String(i + 1), "", "", ""]);
  const tableOf = (rows: string[][]): Table => ({
    id: "x",
    x: 0,
    y: 0,
    kind: "table",
    head: ["Cavity", "Termination", "Dest", "PIN"],
    rows,
  });

  it("grows the table to the count, numbering the new rows on from the last", () => {
    const table = tableOf(cavityRows(2));
    expect(fitCavityRows(table, 5)).toEqual({ added: 3, removed: 0, over: 0 });
    expect(table.rows.map((r) => r[0])).toEqual(["1", "2", "3", "4", "5"]);
    expect(table.rows.every((r) => r.length === 4)).toBe(true);
  });

  it("shrinks it by empty rows from the end only", () => {
    const table = tableOf(cavityRows(6));
    expect(fitCavityRows(table, 4)).toEqual({ added: 0, removed: 2, over: 0 });
    expect(table.rows).toHaveLength(4);
  });

  it("stops at the first row with something in it, and says how many are left over", () => {
    const rows = cavityRows(6);
    if (rows[4]) rows[4][2] = "C2.1";
    const table = tableOf(rows);
    expect(fitCavityRows(table, 3)).toEqual({ added: 0, removed: 1, over: 2 });
    expect(table.rows).toHaveLength(5);
    expect(table.rows[4]?.[2]).toBe("C2.1");
  });

  it("does not take out an empty row from the middle, which would leave a cavity missing", () => {
    const rows = cavityRows(4);
    if (rows[3]) rows[3][3] = "7";
    const table = tableOf(rows);
    expect(fitCavityRows(table, 2).removed).toBe(0);
    expect(table.rows).toHaveLength(4);
  });

  it("leaves a table with no cavity column alone", () => {
    const table: Table = { id: "n", x: 0, y: 0, kind: "table", head: ["Note"], rows: [["a"]] };
    expect(fitCavityRows(table, 4)).toEqual({ added: 0, removed: 0, over: 0 });
    expect(table.rows).toHaveLength(1);
  });
});

describe("what the consistency check says about housings", () => {
  const issues = (doc: HarnessDoc) => validateDoc(doc, t).filter((i) => i.rule === "housings");
  const rows = (n: number): string[][] => Array.from({ length: n }, (_, i) => [String(i + 1), "", "", ""]);

  /** C2 sits in the DIN housing, which has five cavities; C1 is in Multi-pin, which has no count. */
  const withRows = (n: number): HarnessDoc => {
    const doc = drawing();
    const c2 = doc.tables.find((tb) => tb.id === "c2");
    if (c2) c2.rows = rows(n);
    return doc;
  };
  const about = (doc: HarnessDoc, id: string) => issues(doc).filter((i) => i.target?.id === id);

  it("says nothing about a housing that has no count", () => {
    expect(about(drawing(), "c1")).toEqual([]);
  });

  it("is quiet when the rows match the count", () => {
    expect(about(withRows(5), "c2")).toEqual([]);
  });

  it("flags more rows than the housing has cavities, as an error", () => {
    const found = about(withRows(7), "c2");
    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe("error");
    expect(found[0]?.message).toContain("7 cavity rows");
    expect(found[0]?.message).toContain("only 5 cavities");
  });

  it("flags fewer rows than the housing has cavities, as a warning", () => {
    const found = about(withRows(3), "c2");
    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe("warning");
    expect(found[0]?.message).toContain("3 cavity rows");
  });

  it("does not look at a table with no housing", () => {
    const doc = withRows(9);
    const c2 = doc.tables.find((tb) => tb.id === "c2");
    if (c2) delete c2.housing;
    expect(about(doc, "c2")).toEqual([]);
  });

  /** C1 with two contacts, whose symbols are the ones given. */
  const contacts = (first: string, second: string): HarnessDoc => {
    const doc = drawing();
    const terminations = catalogOf(doc, "terminations");
    terminations?.rows.push(["Pin 1.0", "", "", "", "0", ""], ["Socket 1.0", "", "", "", "0", ""]);
    if (terminations) {
      terminations.symbols = { ...terminations.symbols, "Pin 1.0": first, "Socket 1.0": second };
    }
    const c1 = doc.tables.find((tb) => tb.id === "c1");
    if (c1) {
      c1.rows = [
        ["1", "Pin 1.0", "", ""],
        ["2", "Socket 1.0", "", ""],
      ];
    }
    return doc;
  };

  it("flags pins and sockets in one housing", () => {
    const doc = contacts("pin", "socket");
    const c1 = doc.tables.find((tb) => tb.id === "c1") as Table;
    expect(contactGenders(doc, c1)).toEqual({ pins: true, sockets: true });
    const found = about(doc, "c1").filter((i) => i.message.includes("pins and sockets"));
    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe("warning");
  });

  it("does not flag pins alone, or sockets alone", () => {
    expect(about(contacts("pin", "pin"), "c1")).toEqual([]);
    expect(about(contacts("socket", "socket"), "c1")).toEqual([]);
  });
});

describe("the templates in both languages", () => {
  const translators = {
    en: (key: string): string => (en as Record<string, string>)[key] ?? key,
    it: (key: string): string => (italian as Record<string, string>)[key] ?? key,
  };

  for (const [name, tr] of Object.entries(translators)) {
    it(`recognises the termination column of its own cavity table in ${name}`, () => {
      const table = cavityTable(tr, 0, 0);
      const cols = tableColumns(table);
      expect(cols.termination).toBeDefined();
      expect(cols.cavity).toBe(0);
      expect(cols.dest).toBeDefined();
      expect(isCavityTable(table)).toBe(true);
    });
  }
});

describe("which tables are cavity tables", () => {
  it("is not the notes, the revisions or the wire list", () => {
    const tr = (key: string): string => (en as Record<string, string>)[key] ?? key;
    expect(isCavityTable(notesTable(tr as never, 0, 0))).toBe(false);
    expect(isCavityTable(revisionsTable(tr as never, 0, 0))).toBe(false);
    const wireList: Table = {
      id: "w",
      x: 0,
      y: 0,
      kind: "table",
      head: wireListHeadings(tr),
      rows: [["1", "A.1", "B.2", "", "", "", ""]],
    };
    expect(isCavityTable(wireList)).toBe(false);
  });

  it("is not a catalogue or the title block", () => {
    const doc = drawing();
    expect(isCavityTable(catalogOf(doc, "housings") as Table)).toBe(false);
  });
});

describe("making a connector a splice", () => {
  const withTable = (title: string): HarnessDoc =>
    normalizeDoc({
      nodes: [
        { id: "n5", x: 0, y: 0, kind: "connector", name: "C5", style: "plug" },
        { id: "n9", x: 100, y: 0, kind: "connector", name: "C9", style: "plug" },
      ],
      segments: [{ id: "s", a: "n5", b: "n9", len: "", refs: "" }],
      tables: [
        {
          id: "t5",
          node: "n5",
          x: 0,
          y: 0,
          kind: "table",
          title,
          head: ["Cavity", "Dest"],
          rows: [["1", "C9.1"]],
        },
        {
          id: "t9",
          node: "n9",
          x: 0,
          y: 0,
          kind: "table",
          title: "C9",
          head: ["Cavity", "Dest"],
          rows: [["1", "C5.1"]],
        },
      ],
    });

  it("leaves the table on the sheet under the old name, so the wires to it still reach it", () => {
    const doc = withTable("C5");
    expect(spliceNode(doc, "n5")).toBe(true);
    const node = doc.nodes.find((n) => n.id === "n5");
    expect(node).toMatchObject({ kind: "connector", style: "splice", name: "S1" });
    const table = doc.tables.find((tb) => tb.id === "t5") as Table;
    expect(table.node).toBeUndefined();
    expect(ownerName(doc, table)).toBe("C5");
    // C9 still says C5.1, and C5 is still there to be that
    expect(cavityTables(doc).some((ct) => ct.owner === "C5")).toBe(true);
  });

  it("keeps a table that was known by something else answering to the connector's name", () => {
    const doc = withTable("Engine ECU");
    spliceNode(doc, "n5");
    const table = doc.tables.find((tb) => tb.id === "t5") as Table;
    expect(table.title).toBe("C5 Engine ECU");
    expect(ownerName(doc, table)).toBe("C5");
  });

  it("leaves the table without a connector, which the check calls an error", () => {
    const doc = withTable("C5");
    const table = doc.tables.find((tb) => tb.id === "t5") as Table;
    expect(isOrphanTable(doc, table)).toBe(false);
    spliceNode(doc, "n5");
    expect(isOrphanTable(doc, table)).toBe(true);
    // a table of another kind is no pin-out and has no connector to miss
    expect(isOrphanTable(doc, notesTable(t, 0, 0))).toBe(false);
    const issues = validateDoc(doc, t).filter((i) => i.rule === "drawing-hygiene");
    expect(issues).toEqual([
      expect.objectContaining({
        severity: "error",
        message: "Table “C5”: its connector is missing, nothing on the sheet answers to it",
        target: { type: "table", id: "t5" },
      }),
    ]);
  });

  it("keeps the name of a splice that already has one, and takes a node with no table as it is", () => {
    const doc = normalizeDoc({
      nodes: [{ id: "x", x: 0, y: 0, kind: "junction", name: "J1" }],
    });
    spliceNode(doc, "x");
    expect(doc.nodes[0]).toMatchObject({ style: "splice", name: "J1" });
    expect(spliceNode(doc, "missing")).toBe(false);
  });
});

describe("a table that names a termination", () => {
  it("says so when any cavity has one", () => {
    const doc = drawing();
    const c1 = doc.tables.find((tb) => tb.id === "c1") as Table;
    expect(namesATermination(c1)).toBe(true);
    c1.rows = [["1", "", "", ""]];
    expect(namesATermination(c1)).toBe(false);
  });
});
