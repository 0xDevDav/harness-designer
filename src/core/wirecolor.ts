import { DEST_RE, cavityTables, cell } from "./doc";
import type { HarnessDoc } from "./types";

/**
 * Gives a wire a colour.
 *
 * A wire is not stored anywhere: it is what two cavity tables say about each
 * other, and each of them keeps its own colour cell. So recolouring one means
 * writing the cell at both ends, and `ends` are the endpoints as the tables
 * write them (`C3.2`). An end that is a splice or a bare connector has no
 * cavity and so no cell, and is skipped: the wire is still coloured by the end
 * that has one.
 *
 * Returns how many cells were written; zero means the wire has nowhere to keep
 * a colour (no table with a Colour column at either end).
 */
export function setWireColor(doc: HarnessDoc, ends: readonly string[], color: string): number {
  const tables = cavityTables(doc);
  let written = 0;
  for (const end of ends) {
    const match = DEST_RE.exec(end.trim());
    const owner = match?.[1];
    const cavity = match?.[2];
    if (!owner || !cavity) continue;
    for (const { table, cols, owner: tableOwner } of tables) {
      if (tableOwner !== owner || cols.color === undefined) continue;
      const row = table.rows.find((r) => cell(r, cols.cavity) === cavity);
      if (!row) continue;
      while (row.length <= cols.color) row.push("");
      row[cols.color] = color;
      written++;
      break;
    }
  }
  return written;
}
