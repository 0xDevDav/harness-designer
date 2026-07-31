import { cell, isAutoLinkEnabled, ownerName, tableColumns } from "./doc";
import { isGroundColor, wireColorKey } from "./colors";
import type { HarnessDoc, Table } from "./types";

/**
 * Two-ends rule.
 *
 * A wire has two ends, so the same colour can appear in at most two connectors.
 * If it shows up in three or more, either it was entered by mistake or two
 * different wires were given the same code. On the shop floor that turns into a
 * wrong connection, so it has to be flagged prominently.
 *
 * One exception: plain black is ground, which by nature is bridged across as
 * many connectors as needed.
 *
 * Tables with tracking disabled are left out of the count: they are isolated
 * notes and do not describe the real harness.
 */

export interface WireEndsConflict {
  /** colour fingerprint, independent of language and codes */
  colorKey: string;
  /** colour as the user wrote it, for the message */
  label: string;
  /** connectors the colour appears in, in the order they were met */
  owners: string[];
  rows: { tableId: string; rowIndex: number }[];
}

export interface WireEndsReport {
  conflicts: WireEndsConflict[];
  /** rows to highlight, grouped by table */
  rowsByTable: Map<string, Set<number>>;
}

interface Occurrence {
  tableId: string;
  rowIndex: number;
  owner: string;
  label: string;
}

/** Tables that really describe a coloured pin-out; the wire list stays out. */
function colorTables(
  doc: HarnessDoc,
): { table: Table; owner: string; colorCol: number; cavityCol: number }[] {
  const out: { table: Table; owner: string; colorCol: number; cavityCol: number }[] = [];
  for (const table of doc.tables) {
    if (table.kind !== "table" || !isAutoLinkEnabled(table)) continue;
    const cols = tableColumns(table);
    if (cols.color === undefined || cols.cavity === undefined) continue;
    const owner = ownerName(doc, table);
    if (!owner) continue;
    out.push({ table, owner, colorCol: cols.color, cavityCol: cols.cavity });
  }
  return out;
}

export function checkWireEnds(doc: HarnessDoc): WireEndsReport {
  const byColor = new Map<string, Occurrence[]>();

  for (const { table, owner, colorCol } of colorTables(doc)) {
    table.rows.forEach((row, rowIndex) => {
      const value = cell(row, colorCol);
      if (!value || isGroundColor(value)) return;
      const key = wireColorKey(value);
      if (!key) return; // text that is not a colour takes no part in the rule
      const list = byColor.get(key) ?? [];
      list.push({ tableId: table.id, rowIndex, owner, label: value });
      byColor.set(key, list);
    });
  }

  const conflicts: WireEndsConflict[] = [];
  const rowsByTable = new Map<string, Set<number>>();

  for (const [colorKey, occurrences] of byColor) {
    const owners: string[] = [];
    for (const o of occurrences) if (!owners.includes(o.owner)) owners.push(o.owner);
    if (owners.length <= 2) continue;

    conflicts.push({
      colorKey,
      label: occurrences[0]?.label ?? colorKey,
      owners,
      rows: occurrences.map((o) => ({ tableId: o.tableId, rowIndex: o.rowIndex })),
    });
    for (const o of occurrences) {
      const set = rowsByTable.get(o.tableId) ?? new Set<number>();
      set.add(o.rowIndex);
      rowsByTable.set(o.tableId, set);
    }
  }

  return { conflicts, rowsByTable };
}
