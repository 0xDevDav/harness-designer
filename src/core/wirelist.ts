import { cavityTables, cell, resolveDest, NOT_CONNECTED_RE } from "./doc";
import { formatLengthMm } from "./length";
import { columnUnit, sizeForCell, unitLabel, wireUnitOf } from "./wiresize";
import type { HarnessDoc, WireRow } from "./types";

/** Values that mean "not connected" and produce no wire. */
const NOT_CONNECTED = /^(n\.?c\.?|nc|—|-|–|n\/a)$/i;

/** What a wire list row says about the wire, as opposed to where it runs. */
const WIRE_PROPS = ["func", "color", "section"] as const;

/** A cell that says nothing about the wire: empty, or a dash. */
const blank = (value: string): boolean => !value || NOT_CONNECTED_RE.test(value);

/**
 * Builds the wire list from the cavity tables, collapsing mirrored pairs:
 * `C13.1 → CL.1` and `CL.1 → C13.1` are the same wire.
 *
 * Sizes come from tables headed in different ways ("1.5" under "Section (mm²)",
 * "1.5 mm²" under "Section"), so each is read in the unit of its own column and
 * written the way the list's own Section column writes its sizes: bare under the
 * unit the list is headed with once the drawing has one, with the unit under a
 * plain "Section". A size in the other unit keeps its unit, and text that is not
 * a size goes in as it is.
 *
 * The two ends of a wire are one row, and the end met first may be the one
 * that leaves a cell empty (or with a dash) where the other end says what the
 * wire is: the row then takes what the other end says.
 */
export function buildWireList(doc: HarnessDoc): WireRow[] {
  const rows: WireRow[] = [];
  const seen = new Map<string, WireRow>();
  const unit = wireUnitOf(doc);
  // the heading `wireListHeadings` gives the list's Section column
  const listHeading = doc.wireUnit ? unitLabel(doc.wireUnit) : undefined;

  for (const { table, cols, owner } of cavityTables(doc)) {
    const fromUnit = columnUnit(cols.section === undefined ? undefined : table.head?.[cols.section], unit);
    for (const row of table.rows) {
      const cavity = cell(row, cols.cavity);
      const raw = cell(row, cols.dest);
      if (!cavity || !raw || NOT_CONNECTED.test(raw)) continue;

      // the destination may be written "C3.3" or split across "Dest" and "PIN"
      const resolved = resolveDest(row, cols);
      const dest = resolved ? `${resolved.connector}.${resolved.cavity}` : raw;
      const from = `${owner}.${cavity}`;
      const key = resolved ? [from, dest].sort().join("|") : `${from}|${dest}`;
      const props = {
        func: cell(row, cols.func),
        color: cell(row, cols.color),
        section: sizeForCell(cell(row, cols.section), fromUnit, listHeading),
      };
      const first = seen.get(key);
      if (first) {
        for (const prop of WIRE_PROPS)
          if (blank(first[prop]) && !blank(props[prop])) first[prop] = props[prop];
        continue;
      }
      const wire = { index: rows.length + 1, from, to: dest, ...props };
      seen.set(key, wire);
      rows.push(wire);
    }
  }
  return rows;
}

/**
 * A wire list row as cells. The cut length is left blank rather than guessed
 * when it is unknown, so a blank in that column reads as "measure it", never as
 * zero.
 */
const wireCells = (r: WireRow): string[] => [
  String(r.index),
  r.from,
  r.to,
  r.func,
  r.color,
  r.section,
  r.lengthMm === undefined ? "" : formatLengthMm(r.lengthMm),
];

/** Wire list rows in the sheet's own table format. */
export const wireListRows = (rows: WireRow[]): string[][] => rows.map(wireCells);

/**
 * Wire list as CSV with `;` separator and a leading BOM, which is what a
 * European Excel opens correctly on a double click.
 */
export function wireListCsv(rows: WireRow[], headings: string[]): string {
  const escape = (v: string): string => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [headings.map(escape).join(";")];
  for (const r of rows) lines.push(wireCells(r).map(escape).join(";"));
  return "\uFEFF" + lines.join("\r\n");
}

/** Reads a CSV (`;` or `,`) honouring quotes: used by the table import. */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const delimiter = (clean.split("\n")[0]?.match(/;/g)?.length ?? 0) >= 1 ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}
