import { autoLinkRow, insertCavityRow } from "./autolink";
import { DEST_RE, NOT_CONNECTED_RE, cavityTables, cell, resolveDest, writeDest } from "./doc";
import type { CavityTable } from "./doc";
import type { HarnessDoc } from "./types";

/**
 * Connecting and re-connecting wires.
 *
 * A wire is not stored: it is what the cavity tables at its two ends say about
 * each other, so making one, or moving one end of it, is editing those rows.
 * What lives here is the part of that which is bookkeeping, so that dragging an
 * end across the schematic does exactly what retyping it in the tables would
 * have done — including the far end filling itself in, through the same mutual
 * linking, and the colour and size going with the wire rather than
 * staying behind on the cavity it left.
 *
 * Every refusal is decided before anything is written, so a move that cannot
 * happen leaves the drawing as it was.
 */

/** One end of a wire: a cavity (`C3.2`), or a connector or splice with none (`S1`). */
export interface End {
  connector: string;
  cavity?: string;
}

const NAME_RE = /^[A-Za-z0-9_+-]+$/;

export function parseEnd(label: string): End | null {
  const text = label.trim();
  const m = DEST_RE.exec(text);
  if (m?.[1] && m[2]) return { connector: m[1], cavity: m[2] };
  return NAME_RE.test(text) ? { connector: text } : null;
}

export const endLabel = (end: End): string => (end.cavity ? `${end.connector}.${end.cavity}` : end.connector);

export type RewireOutcome =
  | { ok: true }
  /** the cavity asked for already has a wire, going to `other` */
  | { ok: false; reason: "occupied"; other: string }
  /** a wire from a connector to itself is not a wire */
  | { ok: false; reason: "same-connector" }
  /** the end is dropped where it already was */
  | { ok: false; reason: "unchanged" }
  /** neither end has a cavity table to keep the wire in */
  | { ok: false; reason: "no-table" }
  | { ok: false; reason: "no-end" };

const PROPS = ["color", "section"] as const;
type Prop = (typeof PROPS)[number];

/** Nothing written, or a dash standing for it: a cell that has no value to keep. */
const isBlank = (value: string): boolean => value === "" || NOT_CONNECTED_RE.test(value);

interface Found {
  ct: CavityTable;
  index: number;
  row: string[];
}

const width = (ct: CavityTable): number =>
  Math.max(ct.table.head?.length ?? 0, ...ct.table.rows.map((r) => r.length), 1);

/** The row of a cavity, if its connector has a table and the table has the cavity. */
function rowOf(tables: readonly CavityTable[], end: End): Found | null {
  if (!end.cavity) return null;
  for (const ct of tables) {
    if (ct.owner !== end.connector) continue;
    const index = ct.table.rows.findIndex((r) => cell(r, ct.cols.cavity) === end.cavity);
    const row = ct.table.rows[index];
    if (row) return { ct, index, row };
  }
  return null;
}

/** The row of a cavity, adding it to the table when the table lacks it. */
function rowOrNew(tables: readonly CavityTable[], end: End): Found | null {
  const found = rowOf(tables, end);
  if (found || !end.cavity) return found;
  const ct = tables.find((c) => c.owner === end.connector);
  if (!ct) return null;
  const row = insertCavityRow(ct, end.cavity);
  return { ct, index: ct.table.rows.indexOf(row), row };
}

/** Whether a cavity has a table to be written in. */
const hasTable = (tables: readonly CavityTable[], end: End): boolean =>
  !!end.cavity && tables.some((c) => c.owner === end.connector);

/** Where a row sends its wire, as written: `C3.2`, a bare `S1`, or nothing. */
function destText(f: Found): string {
  const dest = resolveDest(f.row, f.ct.cols);
  if (dest) return `${dest.connector}.${dest.cavity}`;
  const raw = cell(f.row, f.ct.cols.dest);
  return NOT_CONNECTED_RE.test(raw) ? "" : raw;
}

function writeEnd(f: Found, to: End): void {
  const { cols } = f.ct;
  if (to.cavity) {
    writeDest(f.row, cols, { connector: to.connector, cavity: to.cavity });
    return;
  }
  while (f.row.length < Math.max(cols.dest, cols.destPin ?? 0) + 1) f.row.push("");
  f.row[cols.dest] = to.connector;
  if (cols.destPin !== undefined) f.row[cols.destPin] = "";
}

function clearEnd(f: Found): void {
  const { cols } = f.ct;
  while (f.row.length < width(f.ct)) f.row.push("");
  f.row[cols.dest] = "";
  if (cols.destPin !== undefined) f.row[cols.destPin] = "";
  for (const prop of PROPS) {
    const col = cols[prop];
    if (col !== undefined) f.row[col] = "";
  }
}

/** Puts a wire property in a row that has nothing there yet, a dash included. */
function fill(f: Found, prop: Prop, value: string): void {
  const col = f.ct.cols[prop];
  if (col === undefined || !value || !isBlank(cell(f.row, col))) return;
  while (f.row.length <= col) f.row.push("");
  f.row[col] = value;
}

/** A row that already has a wire, to somewhere other than `other`. */
function occupant(f: Found | null, other: End): string | null {
  if (!f) return null;
  const dest = destText(f);
  return dest && dest !== endLabel(other) ? dest : null;
}

/**
 * Makes a wire between two ends that have none. Mutates the document, so it has
 * to be called from inside a store edit.
 */
export function connectEnds(doc: HarnessDoc, from: string, to: string): RewireOutcome {
  const a = parseEnd(from);
  const b = parseEnd(to);
  if (!a || !b) return { ok: false, reason: "no-end" };
  if (a.connector === b.connector) return { ok: false, reason: "same-connector" };

  const tables = cavityTables(doc);
  const busy = occupant(rowOf(tables, a), b) ?? occupant(rowOf(tables, b), a);
  if (busy) return { ok: false, reason: "occupied", other: busy };
  if (!hasTable(tables, a) && !hasTable(tables, b)) return { ok: false, reason: "no-table" };

  // the end that has a table is the one the wire is written on; the far end is
  // filled in by mutual linking, the way it would be had it been typed
  const [near, far] = hasTable(tables, a) ? [a, b] : [b, a];
  const row = rowOrNew(tables, near);
  if (!row) return { ok: false, reason: "no-table" };
  writeEnd(row, far);
  autoLinkRow(doc, row.ct.table.id, row.index);
  return { ok: true };
}

/**
 * Takes a wire out: both cavities let go of it. Each end is cleared only if it
 * really points at the other, so a table that disagrees about the wire is not
 * made to lose a different one. The colour and size go with the wire; the
 * function and notes describe the cavity and stay.
 *
 * Returns how many rows were cleared, zero when the tables hold no such wire.
 */
export function disconnectWire(doc: HarnessDoc, ends: readonly [string, string]): number {
  const a = parseEnd(ends[0]);
  const b = parseEnd(ends[1]);
  if (!a || !b) return 0;
  const tables = cavityTables(doc);
  let cleared = 0;
  for (const [mine, other] of [
    [a, b],
    [b, a],
  ] as const) {
    const row = rowOf(tables, mine);
    if (row && destText(row) === endLabel(other)) {
      clearEnd(row);
      cleared++;
    }
  }
  return cleared;
}

/**
 * Moves one end of a wire to another cavity, or another connector.
 *
 * `ends` are the wire's two endpoints as the tables write them and `moving` is
 * which of them is picked up. The end that stays is re-pointed at the new place
 * and the new place at it; the cavity that was left lets go, taking nothing but
 * its own description with it — the colour and size belong to the wire and
 * go where it goes.
 */
export function moveWireEnd(
  doc: HarnessDoc,
  ends: readonly [string, string],
  moving: 0 | 1,
  to: string,
): RewireOutcome {
  const kept = parseEnd(ends[moving === 0 ? 1 : 0]);
  const old = parseEnd(ends[moving]);
  const target = parseEnd(to);
  if (!kept || !old || !target) return { ok: false, reason: "no-end" };
  if (endLabel(target) === endLabel(old)) return { ok: false, reason: "unchanged" };
  if (target.connector === kept.connector) return { ok: false, reason: "same-connector" };

  const tables = cavityTables(doc);
  const busy = occupant(rowOf(tables, target), kept);
  if (busy) return { ok: false, reason: "occupied", other: busy };

  const fk = rowOf(tables, kept);
  // with no row on the end that stays, the wire has to be kept on the new end
  if (!fk && !hasTable(tables, target)) return { ok: false, reason: "no-table" };

  const fo = rowOf(tables, old);
  const props = {} as Record<Prop, string>;
  for (const prop of PROPS) {
    const own = fk ? cell(fk.row, fk.ct.cols[prop]) : "";
    const left = fo ? cell(fo.row, fo.ct.cols[prop]) : "";
    props[prop] = isBlank(own) ? (isBlank(left) ? "" : left) : own;
  }

  if (fo) clearEnd(fo);

  if (fk) {
    writeEnd(fk, target);
    for (const prop of PROPS) fill(fk, prop, props[prop]);
    autoLinkRow(doc, fk.ct.table.id, fk.index);
    // the far end fills in by linking, which leaves a dash where one was typed
    const far = rowOf(cavityTables(doc), target);
    if (far) for (const prop of PROPS) fill(far, prop, props[prop]);
  } else {
    const row = rowOrNew(tables, target);
    if (!row) return { ok: false, reason: "no-table" };
    writeEnd(row, kept);
    for (const prop of PROPS) fill(row, prop, props[prop]);
  }
  return { ok: true };
}
