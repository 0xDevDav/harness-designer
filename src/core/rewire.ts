import { applyBirthDefaults, autoLinkRow, insertCavityRow } from "./autolink";
import { wireColorKey } from "./colors";
import {
  DEST_RE,
  NOT_CONNECTED_RE,
  cavityTables,
  cell,
  connectNodes,
  deleteEntity,
  findNode,
  findSegment,
  nextName,
  resolveDest,
  splitSegment,
  writeDest,
} from "./doc";
import type { CavityTable } from "./doc";
import { uid } from "./ids";
import { findPath, namedNodes, pathNodes } from "./routing";
import type { HarnessDoc, HNode, WireUnit } from "./types";
import { columnUnit, sameSize, sizeAcross, sizeForCell, wireUnitOf } from "./wiresize";

/**
 * Connecting and re-connecting wires.
 *
 * A wire is not stored: it is what the cavity tables at its two ends say about
 * each other, so making one, or moving one end of it, is editing those rows.
 * What lives here is the part of that which is bookkeeping, so that dragging an
 * end across the schematic does exactly what retyping it in the tables would
 * have done, including the far end filling itself in, through the same mutual
 * linking, and the colour, size and type going with the wire rather than
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

const PROPS = ["color", "section", "type"] as const;
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

/**
 * Lets go of the wire a row has. The colour and size go too unless
 * `keepDetails`: they belong to the wire when it is moved, and stay with the
 * cavity when the wire is taken out, so putting a wire back finds them there.
 */
function clearEnd(f: Found, keepDetails = false): void {
  const { cols } = f.ct;
  while (f.row.length < width(f.ct)) f.row.push("");
  f.row[cols.dest] = "";
  if (cols.destPin !== undefined) f.row[cols.destPin] = "";
  if (keepDetails) return;
  for (const prop of PROPS) {
    const col = cols[prop];
    if (col !== undefined) f.row[col] = "";
  }
}

/** The heading of a row's Section column, which says what unit a bare size there is in. */
const sizeHeading = (f: Found | null): string | undefined => {
  const col = f?.ct.cols.section;
  return col === undefined ? undefined : f?.ct.table.head?.[col];
};

/**
 * A wire detail as `f`'s table writes it, read from the row it comes from: a
 * size goes from the way one column writes it to the way the other does.
 */
const carried = (f: Found, prop: Prop, { value, from }: Detail, unit: WireUnit): string =>
  prop === "section" ? sizeAcross(value, sizeHeading(from), sizeHeading(f), unit) : value;

/** Gives the loser the details the winner has, wherever the winner has one. */
function adopt(winner: Found, loser: Found, unit: WireUnit): void {
  for (const prop of PROPS) {
    const to = loser.ct.cols[prop];
    const value = cell(winner.row, winner.ct.cols[prop]);
    if (to === undefined || isBlank(value)) continue;
    while (loser.row.length <= to) loser.row.push("");
    loser.row[to] = carried(loser, prop, { value, from: winner }, unit);
  }
}

/**
 * Which cavity's colour and size a wire takes when the two it joins disagree:
 * `start` is the cavity the wire comes from, `target` the one it is dropped on.
 */
export type Prefer = "start" | "target";

/** What is being done to a wire: one of its ends is moved, or a new wire starts at a cavity. */
export type WireOp =
  { kind: "move"; ends: readonly [string, string]; moving: 0 | 1 } | { kind: "new"; from: string };

export interface DetailDifference {
  /** the column's heading, as the start's table writes it */
  label: string;
  start: string;
  target: string;
}

/** Two cavities about to share a wire that they describe differently. */
export interface DetailsConflict {
  start: string;
  target: string;
  differences: DetailDifference[];
}

/** The same text once spelled the way the tables vary it: case, spaces, a decimal comma. */
const plain = (v: string): string => v.trim().toLowerCase().replace(/\s+/g, " ").replace(/,/g, ".");

function sameDetail(prop: Prop, a: string, b: string): boolean {
  if (prop === "color") {
    const ka = wireColorKey(a);
    const kb = wireColorKey(b);
    if (ka && kb) return ka === kb;
  }
  return plain(a) === plain(b);
}

/** The end that stays and the end that is let go, for an operation; the latter only when a wire is moved. */
function endsOfOp(op: WireOp): { kept: End | null; old: End | null } {
  if (op.kind === "new") return { kept: parseEnd(op.from), old: null };
  return { kept: parseEnd(op.ends[op.moving === 0 ? 1 : 0]), old: parseEnd(op.ends[op.moving]) };
}

/** One of the wire's details, and the row it was read from. */
interface Detail {
  value: string;
  from: Found | null;
}

/** The colour and size the wire has: those of the end that stays, or of the one it leaves if that has none. */
function wireDetails(tables: readonly CavityTable[], kept: End, old: End | null): Record<Prop, Detail> {
  const fk = rowOf(tables, kept);
  const fo = old ? rowOf(tables, old) : null;
  const out = {} as Record<Prop, Detail>;
  for (const prop of PROPS) {
    const own = fk ? cell(fk.row, fk.ct.cols[prop]) : "";
    const left = fo ? cell(fo.row, fo.ct.cols[prop]) : "";
    out[prop] = !isBlank(own)
      ? { value: own, from: fk }
      : !isBlank(left)
        ? { value: left, from: fo }
        : { value: "", from: null };
  }
  return out;
}

/** The unit a bare size in a row's Section column is in. */
const sizeUnitOf = (f: Found | null, unit: WireUnit): WireUnit => columnUnit(sizeHeading(f), unit);

/**
 * What the wire and the cavity it is dropped on disagree about, or null when
 * they agree or one of them has nothing to say. A blank is not a disagreement:
 * it takes what the other has, as it always did.
 */
export function detailsConflict(doc: HarnessDoc, op: WireOp, to: string): DetailsConflict | null {
  const { kept, old } = endsOfOp(op);
  const target = parseEnd(to);
  if (!kept || !target?.cavity) return null;
  const tables = cavityTables(doc);
  const ft = rowOf(tables, target);
  if (!ft) return null;
  const mine = wireDetails(tables, kept, old);
  const fk = rowOf(tables, kept) ?? (old ? rowOf(tables, old) : null);
  const unit = wireUnitOf(doc);
  const differences: DetailDifference[] = [];
  for (const prop of PROPS) {
    const col = ft.ct.cols[prop];
    const theirs = cell(ft.row, col);
    const { value, from } = mine[prop];
    if (isBlank(value) || isBlank(theirs)) continue;
    const same =
      prop === "section"
        ? sameSize(value, sizeUnitOf(from, unit), theirs, sizeUnitOf(ft, unit))
        : sameDetail(prop, value, theirs);
    if (same) continue;
    const heading = fk?.ct.cols[prop] === undefined ? undefined : fk.ct.table.head?.[fk.ct.cols[prop]];
    // two sizes are shown each with its unit and a point, as the check shows them
    const shown = (text: string, f: Found | null): string =>
      prop === "section" ? sizeForCell(text, sizeUnitOf(f, unit), undefined) : text;
    differences.push({
      label: heading ?? ft.ct.table.head?.[col ?? 0] ?? prop,
      start: shown(value, from),
      target: shown(theirs, ft),
    });
  }
  return differences.length ? { start: endLabel(kept), target: endLabel(target), differences } : null;
}

/** Puts a wire property in a row that has nothing there yet, a dash included. */
function fill(f: Found, prop: Prop, detail: Detail, unit: WireUnit): void {
  const col = f.ct.cols[prop];
  if (col === undefined || !detail.value || !isBlank(cell(f.row, col))) return;
  while (f.row.length <= col) f.row.push("");
  f.row[col] = carried(f, prop, detail, unit);
}

/** Puts a wire property in a row, over whatever it said; a value with nothing in it changes nothing. */
function overwrite(f: Found, prop: Prop, detail: Detail, unit: WireUnit): void {
  const col = f.ct.cols[prop];
  if (col === undefined || isBlank(detail.value)) return;
  while (f.row.length <= col) f.row.push("");
  f.row[col] = carried(f, prop, detail, unit);
}

/** A row that already has a wire, to somewhere other than `other`. */
function occupant(f: Found | null, other: End): string | null {
  if (!f) return null;
  const dest = destText(f);
  return dest && dest !== endLabel(other) ? dest : null;
}

/**
 * A cavity that some other cavity already sends its wire to, though its own row
 * says nothing (a wire written on one side only). Returns that other cavity.
 */
function pointedAt(tables: readonly CavityTable[], end: End, besides: End): string | null {
  if (!end.cavity) return null;
  for (const ct of tables) {
    for (const row of ct.table.rows) {
      const dest = resolveDest(row, ct.cols);
      if (dest?.connector !== end.connector || dest.cavity !== end.cavity) continue;
      const from = `${ct.owner}.${cell(row, ct.cols.cavity)}`;
      if (from !== endLabel(besides)) return from;
    }
  }
  return null;
}

/** What stands in the way of a wire between two cavities: another wire at either end, written on either side. */
const wireInTheWay = (tables: readonly CavityTable[], a: End, b: End): string | null =>
  occupant(rowOf(tables, a), b) ??
  occupant(rowOf(tables, b), a) ??
  pointedAt(tables, a, b) ??
  pointedAt(tables, b, a);

/**
 * Makes a wire between two ends that have none. Mutates the document, so it has
 * to be called from inside a store edit.
 */
export function connectEnds(doc: HarnessDoc, from: string, to: string, prefer?: Prefer): RewireOutcome {
  const a = parseEnd(from);
  const b = parseEnd(to);
  if (!a || !b) return { ok: false, reason: "no-end" };
  if (a.connector === b.connector) return { ok: false, reason: "same-connector" };

  const tables = cavityTables(doc);
  const busy = wireInTheWay(tables, a, b);
  if (busy) return { ok: false, reason: "occupied", other: busy };
  if (!hasTable(tables, a) && !hasTable(tables, b)) return { ok: false, reason: "no-table" };

  // the end that has a table is the one the wire is written on; the far end is
  // filled in by mutual linking, the way it would be had it been typed
  const [near, far] = hasTable(tables, a) ? [a, b] : [b, a];
  const row = rowOrNew(tables, near);
  if (!row) return { ok: false, reason: "no-table" };
  writeEnd(row, far);
  autoLinkRow(doc, row.ct.table.id, row.index);
  // a wire made here is a new wire: it starts from the defaults, at both ends
  applyBirthDefaults(doc, row.ct.table.id, row.index);
  if (prefer) settle(doc, a, b, prefer);
  return { ok: true };
}

/** Makes the two cavities of a wire agree about it, the preferred one's details winning. */
function settle(doc: HarnessDoc, start: End, target: End, prefer: Prefer): void {
  const tables = cavityTables(doc);
  const fs = rowOf(tables, start);
  const ft = rowOf(tables, target);
  if (!fs || !ft) return;
  const unit = wireUnitOf(doc);
  if (prefer === "start") adopt(fs, ft, unit);
  else adopt(ft, fs, unit);
}

/**
 * Takes a wire out: both cavities let go of it. Each end is cleared only if it
 * really points at the other, so a table that disagrees about the wire is not
 * made to lose a different one. What the cavity says about the wire (colour,
 * size, type, function, notes) stays, so that putting the wire back, or another one
 * in its place, does not start from an empty row.
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
      clearEnd(row, true);
      cleared++;
    }
  }
  return cleared;
}

/** A row that sends its wire to the connector, by cavity or by its bare name. */
const pointsAt = (f: Found, name: string): boolean => {
  const dest = destText(f);
  return dest === name || dest.startsWith(`${name}.`);
};

/** How many wires touch a connector or splice: its own rows with a destination, and every row that goes to it. */
export function connectionCount(doc: HarnessDoc, name: string): number {
  const wires = new Set<string>();
  for (const ct of cavityTables(doc)) {
    ct.table.rows.forEach((row, index) => {
      const found = { ct, index, row };
      const dest = destText(found);
      if (!dest || (ct.owner !== name && !pointsAt(found, name))) return;
      wires.add([`${ct.owner}.${cell(row, ct.cols.cavity)}`, dest].sort().join("|"));
    });
  }
  return wires.size;
}

/**
 * Takes a connector, or a splice, out of the drawing: every other cavity that
 * went to it lets go of its wire, its own cavity table goes, and the node goes
 * from the sheet with the branches attached to it, which is what deleting it on the
 * sheet does. What those cavities say about their wires stays, as it does when
 * a wire is deleted. Returns how many wires were disconnected.
 */
export function deleteConnector(doc: HarnessDoc, name: string, nodeId?: string): number {
  const wires = connectionCount(doc, name);
  const tables = cavityTables(doc);
  for (const ct of tables) {
    if (ct.owner === name) continue;
    ct.table.rows.forEach((row, index) => {
      const found = { ct, index, row };
      if (pointsAt(found, name)) clearEnd(found, true);
    });
  }
  const own = new Set(tables.filter((ct) => ct.owner === name).map((ct) => ct.table.id));
  doc.tables = doc.tables.filter((t) => !own.has(t.id));
  if (doc.schematic) delete doc.schematic[name];
  if (nodeId) deleteEntity(doc, "node", nodeId);
  return wires;
}

/**
 * Moves one end of a wire to another cavity, or another connector.
 *
 * `ends` are the wire's two endpoints as the tables write them and `moving` is
 * which of them is picked up. The end that stays is re-pointed at the new place
 * and the new place at it; the cavity that was left lets go, taking nothing but
 * its own description with it: the colour, size and type belong to the wire and
 * go where it goes.
 */
export function moveWireEnd(
  doc: HarnessDoc,
  ends: readonly [string, string],
  moving: 0 | 1,
  to: string,
  prefer?: Prefer,
): RewireOutcome {
  const kept = parseEnd(ends[moving === 0 ? 1 : 0]);
  const old = parseEnd(ends[moving]);
  const target = parseEnd(to);
  if (!kept || !old || !target) return { ok: false, reason: "no-end" };
  if (endLabel(target) === endLabel(old)) return { ok: false, reason: "unchanged" };
  if (target.connector === kept.connector) return { ok: false, reason: "same-connector" };

  const tables = cavityTables(doc);
  const busy = occupant(rowOf(tables, target), kept) ?? pointedAt(tables, target, kept);
  if (busy) return { ok: false, reason: "occupied", other: busy };

  const fk = rowOf(tables, kept);
  // with no row on the end that stays, the wire has to be kept on the new end
  if (!fk && !hasTable(tables, target)) return { ok: false, reason: "no-table" };

  const fo = rowOf(tables, old);
  const props = wireDetails(tables, kept, old);
  const unit = wireUnitOf(doc);

  if (fo) clearEnd(fo);

  if (fk) {
    writeEnd(fk, target);
    for (const prop of PROPS) fill(fk, prop, props[prop], unit);
    autoLinkRow(doc, fk.ct.table.id, fk.index);
    // the far end fills in by linking, which leaves a dash where one was typed
    const far = rowOf(cavityTables(doc), target);
    if (far) for (const prop of PROPS) fill(far, prop, props[prop], unit);
  } else {
    const row = rowOrNew(tables, target);
    if (!row) return { ok: false, reason: "no-table" };
    writeEnd(row, kept);
    // the end that stays is a splice, which has no row: its side of the question is
    // the wire's own details, those of the cavity being left, which the window showed
    for (const prop of PROPS) {
      if (prefer === "start") overwrite(row, prop, props[prop], unit);
      else fill(row, prop, props[prop], unit);
    }
  }
  if (prefer) settle(doc, kept, target, prefer);
  return { ok: true };
}

/**
 * Joins a wire to a cavity through a new splice instead of making one wire of
 * the two: the cavity that stays and the one the wire is dropped on each keep
 * their own colour and size and each send a wire to the splice. The splice is
 * put on the sheet where it is on the way, at the nearest junction between
 * the two connectors, so that both wires can be followed to it. When a branch
 * had to be split for that junction, `split` is the length it had, which the
 * split leaves for the person to write again on each half.
 */
export function connectViaSplice(
  doc: HarnessDoc,
  op: WireOp,
  to: string,
): RewireOutcome & { splice?: string; split?: string } {
  const { kept, old } = endsOfOp(op);
  const target = parseEnd(to);
  if (!kept?.cavity || !target?.cavity || (op.kind === "move" && !old))
    return { ok: false, reason: "no-end" };
  if (old && endLabel(target) === endLabel(old)) return { ok: false, reason: "unchanged" };
  if (target.connector === kept.connector) return { ok: false, reason: "same-connector" };

  const tables = cavityTables(doc);
  const fk = rowOf(tables, kept);
  const ft = rowOf(tables, target);
  if (!fk || !ft) return { ok: false, reason: "no-table" };
  // the cavity that stays has its wire only when that wire is the one being moved
  const taken =
    destText(ft) || (op.kind === "new" ? destText(fk) : "") || (pointedAt(tables, target, kept) ?? "");
  if (taken) return { ok: false, reason: "occupied", other: taken };

  const fo = old ? rowOf(tables, old) : null;
  const { name: splice, split } = addSpliceBetween(doc, kept.connector, target.connector);
  if (fo) clearEnd(fo);
  writeEnd(fk, { connector: splice });
  writeEnd(ft, { connector: splice });
  // the wire to the cavity dropped on is new, and so is the other one unless it
  // is a wire being moved, which keeps the cells it has as any moved wire does
  applyBirthDefaults(doc, ft.ct.table.id, ft.index);
  if (op.kind === "new") applyBirthDefaults(doc, fk.ct.table.id, fk.index);
  return split ? { ok: true, splice, split } : { ok: true, splice };
}

/**
 * A new splice on the sheet, on the way from one connector to the other: a
 * leaf off the first junction the bundle passes through, or off a junction put
 * in the middle of the first branch when it passes through none. When the two
 * connectors are not joined at all it is put by the first one and left for
 * the check to say that no branch reaches it. Returns the splice's name, and
 * the length of the branch it split, if it split one that had a length.
 */
function addSpliceBetween(doc: HarnessDoc, from: string, to: string): { name: string; split?: string } {
  const names = namedNodes(doc);
  const a = names.get(from);
  const b = names.get(to);
  let anchor: HNode | undefined;
  let split = "";
  const path = a && b ? findPath(doc, a.id, b.id) : null;
  if (a && path?.length) {
    const along = pathNodes(doc, a.id, path).slice(1, -1);
    anchor = along.map((id) => findNode(doc, id)).find((n) => n?.kind === "junction");
    const first = findSegment(doc, path[0] ?? "");
    if (!anchor && first) {
      const len = first.len.trim();
      anchor = splitSegment(doc, first, 0.5) ?? undefined;
      if (anchor) split = len;
    }
  }
  const at = anchor ?? a;
  const name = nextName(doc, "S");
  const node: HNode = {
    id: uid("n"),
    x: (at?.x ?? 0) + (anchor ? 0 : 80),
    y: (at?.y ?? 0) + 70,
    kind: "connector",
    name,
    style: "splice",
    refs: "",
  };
  doc.nodes.push(node);
  if (anchor) connectNodes(doc, anchor.id, node.id);
  return split ? { name, split } : { name };
}
