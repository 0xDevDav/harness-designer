import { describe, expect, it } from "vitest";
import { normalizeDoc } from "@/core/doc";
import { wireListHeadings } from "@/core/factories";
import { validateDoc } from "@/core/validate";
import { buildWireList, parseCsv, wireListCsv, wireListRows } from "@/core/wirelist";
import type { HarnessDoc } from "@/core/types";

const HEAD = ["Cavità", "Verso", "Funzione", "Colore", "Sezione"];

interface TableSpec {
  id: string;
  node: string;
  rows: string[][];
  head?: string[];
}

function docWith(names: string[], tables: TableSpec[]): HarnessDoc {
  return normalizeDoc({
    nodes: names.map((name, i) => ({
      id: name.toLowerCase(),
      x: i * 100,
      y: 0,
      kind: "connector",
      name,
    })),
    tables: tables.map((s) => ({
      id: s.id,
      node: s.node,
      x: 0,
      y: 0,
      kind: "table",
      title: s.id,
      head: s.head ?? HEAD,
      rows: s.rows,
    })),
  });
}

describe("buildWireList", () => {
  it("collapses mirrored pairs", () => {
    const doc = docWith(
      ["A", "B"],
      [
        {
          id: "ta",
          node: "a",
          rows: [
            ["1", "B.1", "Massa", "nero", "1.5 mm²"],
            ["2", "B.2", "Stop", "rosso", "1.5 mm²"],
          ],
        },
        {
          id: "tb",
          node: "b",
          rows: [
            ["1", "A.1", "Massa", "nero", "1.5 mm²"],
            ["2", "A.2", "Stop", "rosso", "1.5 mm²"],
          ],
        },
      ],
    );

    const rows = buildWireList(doc);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => [r.from, r.to])).toEqual([
      ["A.1", "B.1"],
      ["A.2", "B.2"],
    ]);
  });

  it("skips n.c., dashes and empty cells", () => {
    const doc = docWith(
      ["A"],
      [
        {
          id: "ta",
          node: "a",
          rows: [
            ["1", "n.c.", "", "", ""],
            ["2", "NC", "", "", ""],
            ["3", "—", "", "", ""],
            ["4", "–", "", "", ""],
            ["5", "-", "", "", ""],
            ["6", "n/a", "", "", ""],
            ["7", "", "", "", ""],
            ["", "B.1", "", "", ""],
            ["9", "Massa scocca", "Massa", "nero", "2.5 mm²"],
          ],
        },
      ],
    );

    const rows = buildWireList(doc);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      index: 1,
      from: "A.9",
      to: "Massa scocca",
      func: "Massa",
      color: "nero",
      section: "2.5 mm²",
    });
  });

  it("numbers the kept rows in sequence", () => {
    const doc = docWith(
      ["A", "B"],
      [
        {
          id: "ta",
          node: "a",
          rows: [
            ["1", "B.1", "", "", ""],
            ["2", "n.c.", "", "", ""],
            ["3", "B.3", "", "", ""],
          ],
        },
        { id: "tb", node: "b", rows: [["9", "A.9", "", "", ""]] },
      ],
    );

    const rows = buildWireList(doc);
    expect(rows.map((r) => r.index)).toEqual([1, 2, 3]);
    expect(rows.map((r) => r.from)).toEqual(["A.1", "A.3", "B.9"]);
  });

  it("carries function, colour and section over from the source row", () => {
    const doc = docWith(
      ["A", "B"],
      [{ id: "ta", node: "a", rows: [["1", "B.1", "Retromarcia", "rosa", "1.5 mm²"]] }],
    );
    // the last cell is the cut length: blank here, because nothing was routed
    expect(wireListRows(buildWireList(doc))).toEqual([
      ["1", "A.1", "B.1", "Retromarcia", "rosa", "1.5 mm²", ""],
    ]);
  });

  it("produces no rows on a document with no cavity tables", () => {
    expect(buildWireList(normalizeDoc({}))).toEqual([]);
  });
});

describe("buildWireList sizes", () => {
  const MM2_HEAD = ["Cavità", "Verso", "Funzione", "Colore", "Sezione (mm²)"];
  const AWG_HEAD = ["Cavità", "Verso", "Funzione", "Colore", "AWG"];

  // A headed "Section (mm²)" with bare numbers, B headed "Section" with the unit in every cell
  const twoTables = (aRows: string[][], bRows: string[][]): HarnessDoc =>
    docWith(
      ["A", "B", "C"],
      [
        { id: "ta", node: "a", head: MM2_HEAD, rows: aRows },
        { id: "tb", node: "b", rows: bRows },
      ],
    );

  it("names the unit in every size under a plain Section heading", () => {
    const doc = twoTables([["1", "C.1", "", "", "1.5"]], [["1", "C.2", "", "", "1,5 mm²"]]);
    expect(buildWireList(doc).map((r) => r.section)).toEqual(["1.5 mm²", "1.5 mm²"]);
  });

  it("writes every size with a point, whichever separator its cell was typed with", () => {
    const doc = twoTables(
      [
        ["1", "C.1", "", "", "1,5"],
        ["2", "C.3", "", "", "0.75"],
      ],
      [
        ["1", "C.2", "", "", "1,5 mm²"],
        ["2", "C.4", "", "", "2,5"],
      ],
    );
    expect(buildWireList(doc).map((r) => r.section)).toEqual(["1.5 mm²", "0.75 mm²", "1.5 mm²", "2.5 mm²"]);
    doc.wireUnit = "mm2";
    expect(buildWireList(doc).map((r) => r.section)).toEqual(["1.5", "0.75", "1.5", "2.5"]);
  });

  it("writes the point in the CSV too, and leaves a comma in text that is not a size", () => {
    const doc = twoTables([["1", "C.1", "", "", "1,5"]], [["1", "C.2", "", "", "2x0,5 schermato"]]);
    const csv = wireListCsv(
      buildWireList(doc),
      wireListHeadings((k) => k, doc.wireUnit),
    );
    const lines = csv.split("\n").slice(1);
    expect(lines[0]).toContain(";1.5 mm²;");
    expect(lines[1]).toContain(";2x0,5 schermato;");
  });

  it("writes bare numbers once the list is headed with the drawing's unit", () => {
    const doc = twoTables([["1", "C.1", "", "", "1.5"]], [["1", "C.2", "", "", "2.5 mm²"]]);
    doc.wireUnit = "mm2";
    expect(buildWireList(doc).map((r) => r.section)).toEqual(["1.5", "2.5"]);
    expect(wireListHeadings((k) => k, doc.wireUnit)[5]).toBe("mm²");
  });

  it("keeps a gauge a gauge in a metric drawing", () => {
    const doc = docWith(
      ["A", "C"],
      [{ id: "ta", node: "a", head: AWG_HEAD, rows: [["1", "C.1", "", "", "16"]] }],
    );
    doc.wireUnit = "mm2";
    expect(buildWireList(doc)[0]?.section).toBe("16 AWG");
    delete doc.wireUnit;
    // the heading alone makes the drawing a gauge one, and the list is headed "Section"
    expect(buildWireList(doc)[0]?.section).toBe("16 AWG");
  });

  it("leaves text that is not a size, and blanks, as they are", () => {
    const doc = twoTables([["1", "C.1", "", "", "2x0.5 shielded"]], [["1", "C.2", "", "", ""]]);
    doc.wireUnit = "mm2";
    expect(buildWireList(doc).map((r) => r.section)).toEqual(["2x0.5 shielded", ""]);
  });

  it("gives one wire one size, whichever end it is read from", () => {
    // the same wire written "1.5" under "Section (mm²)" and "1.5 mm²" under "Section"
    const doc = twoTables([["1", "B.1", "", "", "1.5"]], [["1", "A.1", "", "", "1.5 mm²"]]);
    const rows = buildWireList(doc);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.section).toBe("1.5 mm²");
    // and the check sees the two ends agree
    const t = (key: string): string => key;
    expect(validateDoc(doc, t).map((i) => i.message)).not.toContain("validate.sectionMismatch");

    const reversed = docWith(
      ["A", "B"],
      [
        { id: "tb", node: "b", rows: [["1", "A.1", "", "", "1.5 mm²"]] },
        { id: "ta", node: "a", head: MM2_HEAD, rows: [["1", "B.1", "", "", "1.5"]] },
      ],
    );
    expect(buildWireList(reversed)[0]?.section).toBe("1.5 mm²");
  });

  it("exports the sizes to CSV the way the list writes them", () => {
    const doc = twoTables([["1", "C.1", "", "", "1.5"]], [["1", "C.2", "", "", "1.5 mm²"]]);
    const plain = parseCsv(
      wireListCsv(
        buildWireList(doc),
        wireListHeadings((k) => k),
      ),
    );
    expect(plain.slice(1).map((r) => r[5])).toEqual(["1.5 mm²", "1.5 mm²"]);

    doc.wireUnit = "mm2";
    const headed = parseCsv(
      wireListCsv(
        buildWireList(doc),
        wireListHeadings((k) => k, doc.wireUnit),
      ),
    );
    expect(headed[0]?.[5]).toBe("mm²");
    expect(headed.slice(1).map((r) => r[5])).toEqual(["1.5", "1.5"]);
  });
});

describe("wireListCsv", () => {
  const rows = buildWireList(
    docWith(
      ["A", "B"],
      [
        {
          id: "ta",
          node: "a",
          rows: [
            ["1", "B.1", 'Luce "targa"', "bianco", "1.5 mm²"],
            ["2", "B.2", "Stop; freno", "rosso", "1.5 mm²"],
          ],
        },
      ],
    ),
  );

  it("starts with the BOM", () => {
    const csv = wireListCsv(rows, ["N.", "Da", "A", "Funzione", "Colore", "Sezione"]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.startsWith("﻿")).toBe(true);
    // the BOM comes before the header, nowhere else
    expect(csv.slice(1).includes("﻿")).toBe(false);
  });

  it("uses a semicolon separator and CRLF line endings", () => {
    const csv = wireListCsv(rows, ["N.", "Da", "A", "Funzione", "Colore", "Sezione"]);
    const lines = csv.slice(1).split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("N.;Da;A;Funzione;Colore;Sezione");
    expect(lines[2]?.split(";")[0]).toBe("2");
  });

  it("doubles the quotes and protects fields holding the separator", () => {
    const csv = wireListCsv(rows, ["N.", "Da", "A", "Funzione", "Colore", "Sezione"]);
    expect(csv).toContain('"Luce ""targa"""');
    expect(csv).toContain('"Stop; freno"');
  });

  it("can be read back by parseCsv", () => {
    const head = ["N.", "Da", "A", "Funzione", "Colore", "Sezione", "Lunghezza"];
    const back = parseCsv(wireListCsv(rows, head));
    expect(back[0]).toEqual(head);
    expect(back[1]).toEqual(["1", "A.1", "B.1", 'Luce "targa"', "bianco", "1.5 mm²", ""]);
    expect(back[2]).toEqual(["2", "A.2", "B.2", "Stop; freno", "rosso", "1.5 mm²", ""]);
  });
});

describe("parseCsv", () => {
  it("reads a semicolon file", () => {
    expect(parseCsv("a;b;c\n1;2;3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("reads a comma file when there are no semicolons", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("honours quotes, around the separator and line breaks alike", () => {
    expect(parseCsv('"a;b";c\nx;y')).toEqual([
      ["a;b", "c"],
      ["x", "y"],
    ]);
    expect(parseCsv('a;"prima\nriga";b')).toEqual([["a", "prima\nriga", "b"]]);
  });

  it("reads doubled quotes", () => {
    expect(parseCsv('"dice ""ciao""";b')).toEqual([['dice "ciao"', "b"]]);
  });

  it("drops empty rows and the leading BOM", () => {
    expect(parseCsv("﻿a;b\n\n\n;\nc;d\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("normalizes CRLF and CR line endings", () => {
    expect(parseCsv("a;b\r\nc;d\rc2;d2")).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["c2", "d2"],
    ]);
  });

  it("returns an empty list on empty text", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("\n\n")).toEqual([]);
  });
});
