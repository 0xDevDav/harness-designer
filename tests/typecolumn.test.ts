import { describe, expect, it } from "vitest";
import { normalizeDoc, tableColumns } from "@/core/doc";
import { addTypeColumn } from "@/core/typecolumn";
import type { HarnessDoc, Table } from "@/core/types";

const table = (id: string, head: string[], rows: string[][]): Table => ({
  id,
  x: 0,
  y: 0,
  kind: "table",
  head,
  rows,
});

const docWith = (...tables: Table[]): HarnessDoc => normalizeDoc({ tables });

describe("tableColumns", () => {
  it("recognizes a Wire type column in English and Italian", () => {
    expect(tableColumns(table("t", ["Cavity", "Wire type", "To"], [])).type).toBe(1);
    expect(tableColumns(table("t", ["Cavità", "Tipo filo", "Verso"], [])).type).toBe(1);
    expect(tableColumns(table("t", ["Cavity", "Wire-type", "To"], [])).type).toBe(1);
  });

  it("does not take a plain Type column for the wire type", () => {
    // older sheets use it for the terminal, and a wire type picked into it would overwrite that
    expect(tableColumns(table("t", ["Cavity", "Type", "To"], [])).type).toBeUndefined();
    expect(tableColumns(table("t", ["Cavità", "Tipo", "Verso"], [])).type).toBeUndefined();
    expect(tableColumns(table("t", ["Cavity", "Terminal type", "To"], [])).type).toBeUndefined();
  });

  it("does not take a Wire type column for the cavity or the destination", () => {
    const cols = tableColumns(table("t", ["Cavity", "To", "Wire type"], []));
    expect(cols).toMatchObject({ cavity: 0, dest: 1, type: 2 });
  });

  it("finds none where there is no such heading", () => {
    expect(tableColumns(table("t", ["Cavity", "To", "Function"], [])).type).toBeUndefined();
  });
});

describe("addTypeColumn", () => {
  it("puts the column after the section and keeps every row in step", () => {
    const doc = docWith(
      table(
        "t",
        ["Cavity", "To", "Function", "Colour", "Section", "Notes"],
        [["1", "B.1", "Power", "Red", "1.5", "n"]],
      ),
    );
    expect(addTypeColumn(doc, "Wire type")).toEqual(["t"]);
    expect(doc.tables[0]?.head).toEqual([
      "Cavity",
      "To",
      "Function",
      "Colour",
      "Section",
      "Wire type",
      "Notes",
    ]);
    expect(doc.tables[0]?.rows[0]).toEqual(["1", "B.1", "Power", "Red", "1.5", "", "n"]);
  });

  it("falls back to after the colour, then after the cavity", () => {
    const doc = docWith(
      table("a", ["Cavity", "Colour", "To"], [["1", "Red", "B.1"]]),
      table("b", ["Cavity", "To"], [["1", "B.1"]]),
    );
    addTypeColumn(doc, "Wire type");
    expect(doc.tables[0]?.head).toEqual(["Cavity", "Colour", "Wire type", "To"]);
    expect(doc.tables[1]?.head).toEqual(["Cavity", "Wire type", "To"]);
  });

  it("pads a row that is shorter than the place the column goes", () => {
    const doc = docWith(table("t", ["Cavity", "To", "Colour", "Section"], [["1"]]));
    addTypeColumn(doc, "Wire type");
    expect(doc.tables[0]?.rows[0]).toEqual(["1", "", "", "", ""]);
  });

  it("leaves tables that already have one, and tables that are not cavity tables", () => {
    const doc = docWith(
      table("a", ["Cavity", "Wire type", "To"], [["1", "GXL", "B.1"]]),
      table("n", ["#", "Note"], [["1", "text"]]),
    );
    expect(addTypeColumn(doc, "Wire type")).toEqual([]);
    expect(doc.tables[0]?.head).toEqual(["Cavity", "Wire type", "To"]);
    expect(doc.tables[1]?.head).toEqual(["#", "Note"]);
  });

  it("leaves a plain Type column alone and adds a Wire type column beside it", () => {
    const doc = docWith(table("t", ["Cavity", "Type", "Colour", "To"], [["1", "blade", "Red", "B.1"]]));
    expect(addTypeColumn(doc, "Wire type")).toEqual(["t"]);
    expect(doc.tables[0]?.head).toEqual(["Cavity", "Type", "Colour", "Wire type", "To"]);
    expect(doc.tables[0]?.rows[0]).toEqual(["1", "blade", "Red", "", "B.1"]);
  });

  it("keeps the destination readable by the rest of the application", () => {
    const doc = docWith(table("t", ["Cavity", "To", "Colour"], [["1", "B.1", "Red"]]));
    addTypeColumn(doc, "Wire type");
    const cols = tableColumns(doc.tables[0]!);
    expect(cols).toMatchObject({ cavity: 0, dest: 1, color: 2, type: 3 });
    expect(doc.tables[0]?.rows[0]?.[cols.dest!]).toBe("B.1");
  });
});
