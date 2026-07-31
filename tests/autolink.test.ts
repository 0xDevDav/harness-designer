import { describe, expect, it } from "vitest";
import { autoLinkAll, autoLinkRow, rowHasDestination } from "@/core/autolink";
import { findTable, normalizeDoc, resolveDest, tableColumns, writeDest } from "@/core/doc";
import type { HarnessDoc, Table } from "@/core/types";

/**
 * Fixture document with two connectors and their tables in the shape the
 * customer asks for: Cavity · Colour · Section · Dest · PIN.
 */
function build(options: { c3AutoLink?: boolean } = {}): HarnessDoc {
  const head = ["Cavità", "Colore", "Sezione", "Verso", "PIN"];
  const table = (id: string, node: string, title: string, rows: string[][]): Table => ({
    id,
    node,
    x: 0,
    y: 0,
    kind: "table",
    title,
    head,
    rows,
  });

  return normalizeDoc({
    nodes: [
      { id: "n1", x: 0, y: 0, kind: "connector", name: "C1", style: "plug", refs: "" },
      { id: "n3", x: 100, y: 0, kind: "connector", name: "C3", style: "plug", refs: "" },
      { id: "n5", x: 200, y: 0, kind: "connector", name: "C5", style: "plug", refs: "" },
    ],
    segments: [],
    inlines: [],
    tables: [
      table("t1", "n1", "C1", [
        ["1", "bianco/giallo", "0.5 mm²", "C3", "3"],
        ["2", "", "", "", ""],
      ]),
      {
        ...table("t3", "n3", "C3", [
          ["1", "", "", "", ""],
          ["5", "", "", "", ""],
        ]),
        ...(options.c3AutoLink === false ? { autoLink: false } : {}),
      },
      table("t5", "n5", "C5", [["1", "", "", "", ""]]),
    ],
  });
}

const cellsOf = (doc: HarnessDoc, tableId: string, cavity: string): string[] | undefined => {
  const table = findTable(doc, tableId);
  const cols = tableColumns(table!);
  return table?.rows.find((r) => r[cols.cavity!] === cavity);
};

describe("recognizing the Dest + PIN columns", () => {
  it("with a Cavity column present, PIN is the destination", () => {
    const cols = tableColumns(findTable(build(), "t1")!);
    expect(cols.cavity).toBe(0);
    expect(cols.dest).toBe(3);
    expect(cols.destPin).toBe(4);
  });

  it("without a Cavity column, PIN stays the cavity itself, as in older documents", () => {
    const table: Table = {
      id: "x",
      x: 0,
      y: 0,
      kind: "table",
      head: ["Pin", "Verso"],
      rows: [["1", "C3.2"]],
    };
    const cols = tableColumns(table);
    expect(cols.cavity).toBe(0);
    expect(cols.destPin).toBeUndefined();
  });

  it("a part-number column is not mistaken for a PIN", () => {
    const table: Table = {
      id: "x",
      x: 0,
      y: 0,
      kind: "table",
      head: ["Cavità", "PN contatto", "Verso"],
      rows: [["1", "12345", "C3.2"]],
    };
    expect(tableColumns(table).destPin).toBeUndefined();
  });

  it("reads the destination in both spellings", () => {
    const twoColumns: Table = {
      id: "a",
      x: 0,
      y: 0,
      kind: "table",
      head: ["Cavità", "Verso", "PIN"],
      rows: [["1", "C3", "3"]],
    };
    const legacy: Table = {
      id: "b",
      x: 0,
      y: 0,
      kind: "table",
      head: ["Cavità", "Verso"],
      rows: [["1", "C3.3"]],
    };
    expect(resolveDest(twoColumns.rows[0], tableColumns(twoColumns))).toEqual({
      connector: "C3",
      cavity: "3",
    });
    expect(resolveDest(legacy.rows[0], tableColumns(legacy))).toEqual({ connector: "C3", cavity: "3" });
  });

  it("writes the destination in the table's own format", () => {
    const legacy: Table = {
      id: "b",
      x: 0,
      y: 0,
      kind: "table",
      head: ["Cavità", "Verso"],
      rows: [["1", ""]],
    };
    writeDest(legacy.rows[0]!, tableColumns(legacy), { connector: "C7", cavity: "2" });
    expect(legacy.rows[0]?.[1]).toBe("C7.2");
  });

  it("ignores a destination that is not a reference, such as B+ (FUS 15A)", () => {
    const table: Table = {
      id: "c",
      x: 0,
      y: 0,
      kind: "table",
      head: ["Cavità", "Verso"],
      rows: [["1", "B+ (FUS 15A)"]],
    };
    expect(resolveDest(table.rows[0], tableColumns(table))).toBeNull();
  });
});

describe("mutual linking", () => {
  it("fills the matching cavity in the target connector", () => {
    const doc = build();
    const result = autoLinkRow(doc, "t1", 0);

    expect(result.status).toBe("linked");
    expect(result.to).toBe("C3.3");
    // cavity 3 did not exist: it is created in the right place, between 1 and 5
    expect(result.rowCreated).toBe(true);
    expect(findTable(doc, "t3")?.rows.map((r) => r[0])).toEqual(["1", "3", "5"]);

    const target = cellsOf(doc, "t3", "3");
    expect(target?.[3]).toBe("C1"); // Verso
    expect(target?.[4]).toBe("1"); // PIN
    expect(target?.[1]).toBe("bianco/giallo"); // colore copiato
    expect(target?.[2]).toBe("0.5 mm²"); // sezione copiata
  });

  it("leaves a cavity already linked elsewhere alone and reports the conflict", () => {
    const doc = build();
    const table = findTable(doc, "t3")!;
    table.rows.push(["3", "rosso", "1 mm²", "C7", "2"]);

    const result = autoLinkRow(doc, "t1", 0);
    expect(result.status).toBe("conflict");
    expect(result.conflictWith).toBe("C7.2");
    expect(cellsOf(doc, "t3", "3")?.[3]).toBe("C7"); // invariato
    expect(cellsOf(doc, "t3", "3")?.[1]).toBe("rosso");
  });

  it("fills the empty fields when the link already exists", () => {
    const doc = build();
    findTable(doc, "t3")!.rows.push(["3", "", "", "C1", "1"]);

    const result = autoLinkRow(doc, "t1", 0);
    expect(result.status).toBe("updated");
    expect(cellsOf(doc, "t3", "3")?.[1]).toBe("bianco/giallo");
  });

  it("propagates a colour change to the other end of a wire already linked", () => {
    const doc = build();
    findTable(doc, "t3")!.rows.push(["3", "verde", "1 mm²", "C1", "1"]);

    // the user corrects the colour in C1: the two ends are the same wire
    const result = autoLinkRow(doc, "t1", 0);
    expect(result.status).toBe("updated");
    expect(result.updatedFields).toEqual(["color", "section"]);
    expect(cellsOf(doc, "t3", "3")?.[1]).toBe("bianco/giallo");
    expect(cellsOf(doc, "t3", "3")?.[2]).toBe("0.5 mm²");
  });

  it("propagates the other way round too, from receiver back to initiator", () => {
    const doc = build();
    autoLinkRow(doc, "t1", 0); // stabilisce il legame C1.1 ↔ C3.3
    const c3 = findTable(doc, "t3")!;
    const row = c3.rows.findIndex((r) => r[0] === "3");
    c3.rows[row]![1] = "rosso/blu"; // ora la correzione parte da C3

    expect(autoLinkRow(doc, "t3", row).status).toBe("updated");
    expect(findTable(doc, "t1")?.rows[0]?.[1]).toBe("rosso/blu");
  });

  it("does not overwrite an existing colour until the link is confirmed", () => {
    const doc = build();
    // the target cavity has a colour but declares no destination yet
    findTable(doc, "t3")!.rows.push(["3", "verde", "", "", ""]);

    const result = autoLinkRow(doc, "t1", 0);
    expect(result.status).toBe("linked");
    expect(cellsOf(doc, "t3", "3")?.[1]).toBe("verde");
  });

  it("leaves function alone, being a description rather than a wire property", () => {
    const doc = normalizeDoc({
      nodes: [
        { id: "n1", x: 0, y: 0, kind: "connector", name: "C1", style: "plug", refs: "" },
        { id: "n3", x: 10, y: 0, kind: "connector", name: "C3", style: "plug", refs: "" },
      ],
      segments: [],
      tables: [
        {
          id: "t1",
          node: "n1",
          x: 0,
          y: 0,
          kind: "table",
          title: "C1",
          head: ["Cavità", "Funzione", "Verso"],
          rows: [["1", "Indicatore SX", "C3.3"]],
        },
        {
          id: "t3",
          node: "n3",
          x: 0,
          y: 0,
          kind: "table",
          title: "C3",
          head: ["Cavità", "Funzione", "Verso"],
          rows: [["3", "Freccia sinistra", "C1.1"]],
        },
      ],
    });

    autoLinkRow(doc, "t1", 0);
    expect(findTable(doc, "t3")?.rows[0]?.[1]).toBe("Freccia sinistra");
  });

  it("an isolated table writes to no other connector", () => {
    const doc = build();
    findTable(doc, "t1")!.autoLink = false;

    expect(autoLinkRow(doc, "t1", 0).status).toBe("source-disabled");
    expect(cellsOf(doc, "t3", "3")).toBeUndefined();
  });

  it("an isolated table is not written to by other connectors", () => {
    const doc = build({ c3AutoLink: false });

    expect(autoLinkRow(doc, "t1", 0).status).toBe("target-disabled");
    expect(findTable(doc, "t3")?.rows).toHaveLength(2);
  });

  it("with no target table it invents nothing", () => {
    const doc = build();
    findTable(doc, "t1")!.rows[0]![3] = "C9";

    expect(autoLinkRow(doc, "t1", 0).status).toBe("no-target-table");
    expect(doc.tables).toHaveLength(3);
  });

  it("a row with no destination has no effect", () => {
    const doc = build();
    expect(autoLinkRow(doc, "t1", 1).status).toBe("no-destination");
    expect(rowHasDestination(findTable(doc, "t1")!, 1)).toBe(false);
    expect(rowHasDestination(findTable(doc, "t1")!, 0)).toBe(true);
  });

  it("works with the historical single-column C3.3 format too", () => {
    const doc = normalizeDoc({
      nodes: [
        { id: "n1", x: 0, y: 0, kind: "connector", name: "C1", style: "plug", refs: "" },
        { id: "n3", x: 10, y: 0, kind: "connector", name: "C3", style: "plug", refs: "" },
      ],
      segments: [],
      tables: [
        {
          id: "t1",
          node: "n1",
          x: 0,
          y: 0,
          kind: "table",
          title: "C1",
          head: ["Cavità", "Verso", "Colore"],
          rows: [["1", "C3.3", "nero"]],
        },
        {
          id: "t3",
          node: "n3",
          x: 0,
          y: 0,
          kind: "table",
          title: "C3",
          head: ["Cavità", "Verso", "Colore"],
          rows: [["3", "", ""]],
        },
      ],
    });

    expect(autoLinkRow(doc, "t1", 0).status).toBe("linked");
    expect(cellsOf(doc, "t3", "3")?.[1]).toBe("C1.1");
  });

  it("realigns the whole document in one go", () => {
    const doc = build();
    findTable(doc, "t1")!.rows[1] = ["2", "rosso", "1 mm²", "C5", "1"];

    const results = autoLinkAll(doc);
    expect(results.filter((r) => r.status === "linked")).toHaveLength(2);
    expect(cellsOf(doc, "t5", "1")?.[3]).toBe("C1");
    // running it again creates no duplicates
    autoLinkAll(doc);
    expect(findTable(doc, "t5")?.rows).toHaveLength(1);
  });
});

describe("not-connected cells", () => {
  it("a dash in Dest is not a connector that does not exist", () => {
    const table: Table = {
      id: "x",
      x: 0,
      y: 0,
      kind: "table",
      head: ["Cavità", "Verso", "PIN"],
      rows: [
        ["1", "-", "-"],
        ["2", "n.c.", ""],
        ["3", "/", ""],
        ["4", "—", "—"],
      ],
    };
    const cols = tableColumns(table);
    for (const row of table.rows) expect(resolveDest(row, cols)).toBeNull();
  });

  it("a PIN left empty or marked not connected invents no destination", () => {
    const table: Table = {
      id: "y",
      x: 0,
      y: 0,
      kind: "table",
      head: ["Cavità", "Verso", "PIN"],
      rows: [["1", "C3", "-"]],
    };
    // "Dest C3" with no pin stays without a cavity: nothing is inferred
    expect(resolveDest(table.rows[0], tableColumns(table))).toBeNull();
  });
});
