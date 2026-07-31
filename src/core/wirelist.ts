import { cavityTables, cell, resolveDest } from "./doc";
import type { HarnessDoc, WireRow } from "./types";

/** Values that mean "not connected" and produce no wire. */
const NOT_CONNECTED = /^(n\.?c\.?|nc|—|-|–|n\/a)$/i;

/**
 * Builds the wire list from the cavity tables, collapsing mirrored pairs:
 * `C13.1 → CL.1` and `CL.1 → C13.1` are the same wire.
 */
export function buildWireList(doc: HarnessDoc): WireRow[] {
  const rows: WireRow[] = [];
  const seen = new Set<string>();

  for (const { table, cols, owner } of cavityTables(doc)) {
    for (const row of table.rows) {
      const cavity = cell(row, cols.cavity);
      const raw = cell(row, cols.dest);
      if (!cavity || !raw || NOT_CONNECTED.test(raw)) continue;

      // the destination may be written "C3.3" or split across "Dest" and "PIN"
      const resolved = resolveDest(row, cols);
      const dest = resolved ? `${resolved.connector}.${resolved.cavity}` : raw;
      const from = `${owner}.${cavity}`;
      const key = resolved ? [from, dest].sort().join("|") : `${from}|${dest}`;
      if (seen.has(key)) continue;
      seen.add(key);

      rows.push({
        index: rows.length + 1,
        from,
        to: dest,
        func: cell(row, cols.func),
        color: cell(row, cols.color),
        section: cell(row, cols.section),
      });
    }
  }
  return rows;
}

/** Wire list rows in the sheet's own table format. */
export const wireListRows = (rows: WireRow[]): string[][] =>
  rows.map((r) => [String(r.index), r.from, r.to, r.func, r.color, r.section]);

/**
 * Wire list as CSV with `;` separator and a leading BOM, which is what a
 * European Excel opens correctly on a double click.
 */
export function wireListCsv(rows: WireRow[], headings: string[]): string {
  const escape = (v: string): string => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [headings.map(escape).join(";")];
  for (const r of rows) {
    lines.push([String(r.index), r.from, r.to, r.func, r.color, r.section].map(escape).join(";"));
  }
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
