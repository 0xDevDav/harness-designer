import { cavityTables, cell, isAutoLinkEnabled, resolveDest, tableColumns, writeDest } from "./doc";
import type { CavityTable } from "./doc";
import type { HarnessDoc, Table } from "./types";

/**
 * Automatic mutual linking between cavity tables.
 *
 * Filling cavity 1 of C1 with destination C3 pin 3 fills cavity 3 of C3 with
 * destination C1 pin 1 and with the same wire properties (colour and section).
 * There is only one wire: the two tables describe its two ends, and keeping
 * them in step by hand is the work this function removes.
 *
 * Two principles drive the implementation:
 * 1. data the user already entered is never overwritten with something else: if
 *    the target cavity points elsewhere a conflict is reported and nothing is
 *    touched, because silently losing a link is worse than not creating one;
 * 2. a table with tracking disabled neither writes nor is written to: it stays
 *    an isolated note.
 */

export type AutoLinkStatus =
  /** the target cavity was filled in */
  | "linked"
  /** the link already existed: wire properties were brought in step */
  | "already"
  /** the link already existed and colour or section were updated at the other end */
  | "updated"
  /** the target cavity points at another connector: left untouched */
  | "conflict"
  /** the row states no usable destination */
  | "no-destination"
  /** the source table has tracking disabled */
  | "source-disabled"
  /** the target table has tracking disabled */
  | "target-disabled"
  /** the sheet has no cavity table for the target connector */
  | "no-target-table"
  /** the source table cannot be traced back to a connector */
  | "no-owner";

export interface AutoLinkResult {
  status: AutoLinkStatus;
  /** source connector and source cavity */
  from?: string;
  /** requested destination, in readable form ("C3.3") */
  to?: string;
  /** id of the table that was changed */
  targetTableId?: string;
  /** destination already in place that prevented the link */
  conflictWith?: string;
  /** true if the target cavity had no row and one was added */
  rowCreated?: boolean;
  /** properties brought in step at the other end, to report back to the user */
  updatedFields?: ("color" | "section")[];
}

const label = (connector: string, cavity: string): string => `${connector}.${cavity}`;

/** Minimum width so that every recognized column can be written to. */
function padRow(row: string[], width: number): string[] {
  while (row.length < width) row.push("");
  return row;
}

const tableWidth = (table: Table): number =>
  Math.max(table.head?.length ?? 0, ...table.rows.map((r) => r.length), 1);

/**
 * Inserts a row for a missing cavity while keeping numeric order, so the table
 * does not fall out of sequence when pins are filled in at random.
 */
function insertCavityRow(target: CavityTable, cavity: string): string[] {
  const row = padRow([], tableWidth(target.table));
  row[target.cols.cavity] = cavity;

  const asNumber = Number.parseInt(cavity, 10);
  let at = target.table.rows.length;
  if (Number.isFinite(asNumber)) {
    const index = target.table.rows.findIndex((r) => {
      const value = Number.parseInt(cell(r, target.cols.cavity), 10);
      return Number.isFinite(value) && value > asNumber;
    });
    if (index >= 0) at = index;
  }
  target.table.rows.splice(at, 0, row);
  return row;
}

/**
 * Brings one wire property in step at the other end.
 *
 * With `overwrite` false only empty cells are filled; with `overwrite` true the
 * source value wins. The distinction matters: until both ends confirm the link,
 * data the user already wrote is left alone; once both ends do declare
 * themselves linked they describe the same physical wire, which has a single
 * colour and a single section, and the latest edit is the right one.
 *
 * Returns true if anything changed.
 */
function alignField(
  from: string[],
  to: string[],
  sourceCol: number | undefined,
  targetCol: number | undefined,
  overwrite: boolean,
): boolean {
  if (sourceCol === undefined || targetCol === undefined) return false;
  const value = cell(from, sourceCol);
  if (!value) return false;
  const current = cell(to, targetCol);
  if (current === value) return false;
  if (current && !overwrite) return false;
  padRow(to, targetCol + 1);
  to[targetCol] = value;
  return true;
}

/**
 * Applies mutual linking for one row. Mutates the document, so it must be
 * called from inside a store edit.
 */
export function autoLinkRow(doc: HarnessDoc, tableId: string, rowIndex: number): AutoLinkResult {
  const tables = cavityTables(doc);
  const source = tables.find((c) => c.table.id === tableId);
  if (!source) return { status: "no-owner" };
  if (!isAutoLinkEnabled(source.table)) return { status: "source-disabled" };

  const row = source.table.rows[rowIndex];
  if (!row) return { status: "no-destination" };

  const cavity = cell(row, source.cols.cavity);
  const dest = resolveDest(row, source.cols);
  if (!cavity || !dest) return { status: "no-destination" };

  const from = label(source.owner, cavity);
  const to = label(dest.connector, dest.cavity);

  const target = tables.find((c) => c.owner === dest.connector);
  if (!target) return { status: "no-target-table", from, to };
  if (target.table.id === source.table.id) return { status: "no-destination", from, to };
  if (!isAutoLinkEnabled(target.table)) return { status: "target-disabled", from, to };

  let created = false;
  let targetRow = target.table.rows.find((r) => cell(r, target.cols.cavity) === dest.cavity);
  if (!targetRow) {
    targetRow = insertCavityRow(target, dest.cavity);
    created = true;
  }

  const existing = resolveDest(targetRow, target.cols);
  if (existing && (existing.connector !== source.owner || existing.cavity !== cavity)) {
    return {
      status: "conflict",
      from,
      to,
      targetTableId: target.table.id,
      conflictWith: label(existing.connector, existing.cavity),
    };
  }

  // link confirmed by both ends: from here on they describe the same wire
  const already = !!existing;
  if (!already) writeDest(targetRow, target.cols, { connector: source.owner, cavity });

  const updatedFields: ("color" | "section")[] = [];
  if (alignField(row, targetRow, source.cols.color, target.cols.color, already)) updatedFields.push("color");
  if (alignField(row, targetRow, source.cols.section, target.cols.section, already)) {
    updatedFields.push("section");
  }
  // function is a description, not a physical property: never overwritten
  alignField(row, targetRow, source.cols.func, target.cols.func, false);

  const changed = already && updatedFields.length > 0;
  return {
    status: changed ? "updated" : already ? "already" : "linked",
    from,
    to,
    targetTableId: target.table.id,
    ...(created ? { rowCreated: true } : {}),
    ...(updatedFields.length ? { updatedFields } : {}),
  };
}

/**
 * Realigns the whole document. Useful after a CSV import, or when tracking is
 * switched back on for a table that fell behind.
 */
export function autoLinkAll(doc: HarnessDoc): AutoLinkResult[] {
  const results: AutoLinkResult[] = [];
  for (const { table } of cavityTables(doc)) {
    if (!isAutoLinkEnabled(table)) continue;
    // length is read on every pass: a row can be born during the loop
    for (let i = 0; i < table.rows.length; i++) {
      const result = autoLinkRow(doc, table.id, i);
      if (result.status === "linked" || result.status === "updated" || result.status === "conflict") {
        results.push(result);
      }
    }
  }
  return results;
}

/** True if the given row holds a destination that tracking would act on. */
export function rowHasDestination(table: Table, rowIndex: number): boolean {
  const cols = tableColumns(table);
  const row = table.rows[rowIndex];
  return !!row && !!cell(row, cols.cavity) && !!resolveDest(row, cols);
}
