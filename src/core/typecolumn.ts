import { tableColumns } from "./doc";
import type { HarnessDoc } from "./types";

/**
 * Adds a Type column to every cavity table that does not have one.
 *
 * The column goes after the section when there is one, otherwise after the
 * colour or the cavity, so it sits with the other facts about the wire and its
 * terminal and ahead of the destination. Tables that are not cavity tables
 * (notes, revisions, the wire list) are left alone. Returns the ids of the
 * tables that got the column, which are now wider than they were.
 */
export function addTypeColumn(doc: HarnessDoc, heading: string): string[] {
  const added: string[] = [];
  for (const table of doc.tables) {
    if (table.kind !== "table" || !table.head) continue;
    const cols = tableColumns(table);
    if (cols.cavity === undefined || cols.type !== undefined) continue;

    const at = (cols.section ?? cols.color ?? cols.cavity) + 1;
    table.head.splice(at, 0, heading);
    for (const row of table.rows) {
      while (row.length < at) row.push("");
      row.splice(at, 0, "");
    }
    added.push(table.id);
  }
  return added;
}
