import { cell, isAutoLinkEnabled, ownerName, tableColumns } from "./doc";
import { isGroundColor, wireColorKey } from "./colors";
import { endpointConnector } from "./routing";
import type { HarnessDoc, Table } from "./types";

/**
 * Two-ends rule.
 *
 * A wire has two ends, so the same colour can appear in at most two connectors.
 * If it shows up in three or more, either it was entered by mistake or two
 * different wires were given the same code. On the shop floor that turns into a
 * wrong connection, so it has to be flagged prominently.
 *
 * A splice is the one place where more than two ends of a colour meet: every
 * wire of that colour reaching the same splice is one circuit, however many
 * there are. The colour coming back in a wire that does not reach the splice is
 * still an error, because that is a different circuit wearing the same code.
 *
 * Plain black is ground, which by nature is bridged across as many connectors
 * as needed.
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
  /**
   * The splice holding most of the wires of this colour, when any of them
   * reaches one. Set, `stray` lists the connectors where the colour comes back
   * off that splice, and `rows` holds only theirs.
   */
  splice?: string;
  stray?: string[];
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
  /** the splice the wire goes to, if it goes to one */
  splice?: string;
}

/** Tables that really describe a coloured pin-out; the wire list stays out. */
function colorTables(
  doc: HarnessDoc,
): { table: Table; owner: string; colorCol: number; destCol: number | undefined }[] {
  const out: { table: Table; owner: string; colorCol: number; destCol: number | undefined }[] = [];
  for (const table of doc.tables) {
    if (table.kind !== "table" || !isAutoLinkEnabled(table)) continue;
    const cols = tableColumns(table);
    if (cols.color === undefined || cols.cavity === undefined) continue;
    const owner = ownerName(doc, table);
    if (!owner) continue;
    out.push({ table, owner, colorCol: cols.color, destCol: cols.dest });
  }
  return out;
}

const spliceNames = (doc: HarnessDoc): Set<string> =>
  new Set(doc.nodes.filter((n) => n.style === "splice" && n.name.trim()).map((n) => n.name.trim()));

/** Distinct values, in the order they were met. */
const distinct = (values: string[]): string[] => [...new Set(values)];

/** The splice holding most of these wires; the first met wins a tie. */
function mainSplice(occurrences: Occurrence[]): string | undefined {
  const count = new Map<string, number>();
  for (const o of occurrences) if (o.splice) count.set(o.splice, (count.get(o.splice) ?? 0) + 1);
  let best: string | undefined;
  for (const [splice, n] of count) if (!best || n > count.get(best)!) best = splice;
  return best;
}

export function checkWireEnds(doc: HarnessDoc): WireEndsReport {
  const byColor = new Map<string, Occurrence[]>();
  const splices = spliceNames(doc);

  for (const { table, owner, colorCol, destCol } of colorTables(doc)) {
    table.rows.forEach((row, rowIndex) => {
      const value = cell(row, colorCol);
      if (!value || isGroundColor(value)) return;
      const key = wireColorKey(value);
      if (!key) return; // text that is not a colour takes no part in the rule
      const to = endpointConnector(cell(row, destCol));
      const list = byColor.get(key) ?? [];
      list.push({
        tableId: table.id,
        rowIndex,
        owner,
        label: value,
        ...(splices.has(to) ? { splice: to } : {}),
      });
      byColor.set(key, list);
    });
  }

  const conflicts: WireEndsConflict[] = [];
  const rowsByTable = new Map<string, Set<number>>();

  for (const [colorKey, occurrences] of byColor) {
    const owners = distinct(occurrences.map((o) => o.owner));
    if (owners.length <= 2) continue;

    const label = occurrences[0]?.label ?? colorKey;
    const splice = mainSplice(occurrences);
    const flagged = splice ? occurrences.filter((o) => o.splice !== splice) : occurrences;
    if (!flagged.length) continue;

    conflicts.push({
      colorKey,
      label,
      owners,
      ...(splice ? { splice, stray: distinct(flagged.map((o) => o.owner)) } : {}),
      rows: flagged.map((o) => ({ tableId: o.tableId, rowIndex: o.rowIndex })),
    });
    for (const o of flagged) {
      const set = rowsByTable.get(o.tableId) ?? new Set<number>();
      set.add(o.rowIndex);
      rowsByTable.set(o.tableId, set);
    }
  }

  return { conflicts, rowsByTable };
}
