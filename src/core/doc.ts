import { DOC_VERSION } from "./types";
import type { DocMeta, HarnessDoc, HNode, Inline, Segment, Table } from "./types";
import { seedIds, uid } from "./ids";
import { T_MAX, T_MIN, clamp } from "./geometry";

/* ============================ Construction ============================ */

export function emptyMeta(): DocMeta {
  return {
    title: "",
    description: "",
    partNumber: "",
    revision: "A",
    company: "",
    drawnBy: "",
    date: new Date().toLocaleDateString(),
  };
}

export function emptyDoc(): HarnessDoc {
  return { version: DOC_VERSION, meta: emptyMeta(), nodes: [], segments: [], inlines: [], tables: [] };
}

export const cloneDoc = (d: HarnessDoc): HarnessDoc => JSON.parse(JSON.stringify(d)) as HarnessDoc;

/* ============================ Normalization ============================ */

const str = (v: unknown, fallback = ""): string =>
  typeof v === "string" ? v : v == null ? fallback : String(v);
const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Turns any incoming object into a usable document: fills in missing fields,
 * drops invalid elements and restores the invariants. This is the barrier that
 * protects rendering: no other part of the program has to defend itself
 * against dangling references.
 *
 * It also accepts documents written before the format carried a version
 * field, and files edited by hand.
 */
export function normalizeDoc(input: unknown): HarnessDoc {
  const raw = (typeof input === "object" && input !== null ? input : {}) as Partial<HarnessDoc>;
  const doc = emptyDoc();

  const meta = (typeof raw.meta === "object" && raw.meta !== null ? raw.meta : {}) as Partial<DocMeta>;
  doc.meta = {
    title: str(meta.title),
    description: str(meta.description),
    partNumber: str(meta.partNumber),
    revision: str(meta.revision, "A"),
    company: str(meta.company),
    drawnBy: str(meta.drawnBy),
    date: str(meta.date, new Date().toLocaleDateString()),
  };

  // --- nodes: unique ids, finite coordinates
  const seenNodeIds = new Set<string>();
  for (const n of asArray(raw.nodes)) {
    const src = n as Partial<HNode>;
    const id = str(src.id);
    if (!id || seenNodeIds.has(id)) continue;
    seenNodeIds.add(id);
    const node: HNode = {
      id,
      x: num(src.x),
      y: num(src.y),
      kind: src.kind === "connector" ? "connector" : "junction",
      name: str(src.name),
      style: str(src.style, "plug") || "plug",
      refs: str(src.refs),
    };
    const mate = str(src.mate);
    if (mate && mate !== id) node.mate = mate;
    doc.nodes.push(node);
  }
  normalizeMates(doc);

  // --- segments: both ends must exist, no self-loops, no duplicate pairs
  const seenSegIds = new Set<string>();
  const seenPairs = new Set<string>();
  for (const s of asArray(raw.segments)) {
    const src = s as Partial<Segment>;
    const id = str(src.id);
    const a = str(src.a);
    const b = str(src.b);
    if (!id || seenSegIds.has(id)) continue;
    if (!seenNodeIds.has(a) || !seenNodeIds.has(b) || a === b) continue;
    // NUL separator written as an escape: a raw byte in the source would make
    // the file binary to Git and to text search, and the diff would be lost.
    // No id can contain it, so the pair key stays unambiguous.
    const pair = [a, b].sort().join("\u0000");
    if (seenPairs.has(pair)) continue;
    seenSegIds.add(id);
    seenPairs.add(pair);
    doc.segments.push({ id, a, b, len: str(src.len), refs: str(src.refs) });
  }

  // --- inline labels: must sit on a segment that exists
  const seenInlineIds = new Set<string>();
  for (const i of asArray(raw.inlines)) {
    const src = i as Partial<Inline>;
    const id = str(src.id);
    const seg = str(src.seg);
    if (!id || seenInlineIds.has(id) || !seenSegIds.has(seg)) continue;
    seenInlineIds.add(id);
    doc.inlines.push({
      id,
      seg,
      t: clamp(num(src.t, 0.5), T_MIN, T_MAX),
      text: str(src.text),
      color: str(src.color, "#e8942a") || "#e8942a",
    });
  }

  // --- tables: rectangular rows, a single title block, node links verified
  const seenTableIds = new Set<string>();
  let titleBlockSeen = false;
  for (const t of asArray(raw.tables)) {
    const src = t as Partial<Table>;
    const id = str(src.id);
    if (!id || seenTableIds.has(id)) continue;
    const kind: Table["kind"] = src.kind === "title" ? "title" : "table";
    if (kind === "title") {
      if (titleBlockSeen) continue; // there is only ever one title block
      titleBlockSeen = true;
    }
    seenTableIds.add(id);
    const head = asArray(src.head).map((h) => str(h));
    const rows = asArray(src.rows).map((r) => asArray(r).map((c) => str(c)));
    const width = Math.max(head.length, ...rows.map((r) => r.length), 0);
    for (const r of rows) while (r.length < width) r.push("");
    const table: Table = { id, x: num(src.x), y: num(src.y), kind, rows };
    if (src.title !== undefined) table.title = str(src.title);
    if (head.length) table.head = head;
    const node = str(src.node);
    if (node && seenNodeIds.has(node)) table.node = node;
    if (src.autoLink === false) table.autoLink = false;
    doc.tables.push(table);
  }

  doc.version = DOC_VERSION;
  normalizeConnectors(doc);
  seedIds(doc.nodes.length + doc.segments.length + doc.inlines.length + doc.tables.length);
  return doc;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/**
 * Invariant: mating is mutual and exclusive.
 *
 * A connector mates with one other connector, which names it back. A link to a
 * node that is gone, to itself, or to one that has since paired off with a
 * third is dropped rather than half-kept, because a joint that only one side
 * knows about would route wires through a hole the other end cannot see.
 */
export function normalizeMates(doc: HarnessDoc): void {
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const degree = new Map<string, number>();
  for (const s of doc.segments) {
    degree.set(s.a, (degree.get(s.a) ?? 0) + 1);
    degree.set(s.b, (degree.get(s.b) ?? 0) + 1);
  }
  // a joint is between two ends, so a node the bundle runs through cannot be
  // half of one however it came to have the link
  const terminal = (n: HNode): boolean => (degree.get(n.id) ?? 0) <= 1;
  for (const n of doc.nodes) {
    if (!n.mate) continue;
    const other = byId.get(n.mate);
    if (!other || other.id === n.id || other.mate !== n.id) delete n.mate;
    else if (!terminal(n) || !terminal(other)) delete n.mate;
  }
  // one side may have survived the pass that dropped the other
  for (const n of doc.nodes) {
    if (n.mate && byId.get(n.mate)?.mate !== n.id) delete n.mate;
  }
}

/**
 * Invariant: a termination only ever lives at the end of a branch. A node the
 * bundle passes through goes back to being a junction.
 */
export function normalizeConnectors(doc: HarnessDoc): void {
  const degree = new Map<string, number>();
  for (const s of doc.segments) {
    degree.set(s.a, (degree.get(s.a) ?? 0) + 1);
    degree.set(s.b, (degree.get(s.b) ?? 0) + 1);
  }
  for (const n of doc.nodes) {
    if (n.kind === "connector" && (degree.get(n.id) ?? 0) > 1) n.kind = "junction";
  }
}

/* ============================ Queries ============================ */

export const findNode = (doc: HarnessDoc, id: string): HNode | undefined =>
  doc.nodes.find((n) => n.id === id);
export const findSegment = (doc: HarnessDoc, id: string): Segment | undefined =>
  doc.segments.find((s) => s.id === id);
export const findInline = (doc: HarnessDoc, id: string): Inline | undefined =>
  doc.inlines.find((i) => i.id === id);
export const findTable = (doc: HarnessDoc, id: string): Table | undefined =>
  doc.tables.find((t) => t.id === id);

/** Both ends of a segment; `null` if the document is not normalized. */
export function segmentEnds(doc: HarnessDoc, s: Segment): [HNode, HNode] | null {
  const a = findNode(doc, s.a);
  const b = findNode(doc, s.b);
  return a && b ? [a, b] : null;
}

export const segmentsOf = (doc: HarnessDoc, nodeId: string): Segment[] =>
  doc.segments.filter((s) => s.a === nodeId || s.b === nodeId);

export const nodeDegree = (doc: HarnessDoc, nodeId: string): number => segmentsOf(doc, nodeId).length;

export const isTerminalNode = (doc: HarnessDoc, nodeId: string): boolean => nodeDegree(doc, nodeId) <= 1;

/** Next free name with a given prefix (C1, C2, …). */
export function nextName(doc: HarnessDoc, prefix: string): string {
  const taken = new Set(doc.nodes.map((n) => n.name));
  let i = 1;
  while (taken.has(prefix + i)) i++;
  return prefix + i;
}

/* ============================ Table ↔ connector link ============================ */

const titleMatchesName = (title: string | undefined, name: string): boolean =>
  !!title && !!name && (title === name || title.startsWith(name + " "));

/** A connector's cavity table: explicit link, falling back to the title when there is none. */
export function tableForNode(doc: HarnessDoc, nodeId: string): Table | undefined {
  const n = findNode(doc, nodeId);
  if (!n) return undefined;
  return (
    doc.tables.find((t) => t.node === nodeId) ??
    (n.name ? doc.tables.find((t) => t.kind === "table" && titleMatchesName(t.title, n.name)) : undefined)
  );
}

export function nodeForTable(doc: HarnessDoc, t: Table): HNode | undefined {
  if (t.node) {
    const n = findNode(doc, t.node);
    if (n) return n;
  }
  if (!t.title) return undefined;
  return doc.nodes.find((n) => n.kind === "connector" && titleMatchesName(t.title, n.name));
}

/* ============================ Cavity table columns ============================ */

export interface TableColumns {
  cavity?: number;
  dest?: number;
  /** column holding only the target cavity, when the destination is split across “Dest” + “PIN” */
  destPin?: number;
  color?: number;
  section?: number;
  func?: number;
}

/**
 * Recognizes columns from their headers, in Italian and in English.
 *
 * “PIN” is ambiguous: many drawings use it as a synonym for the cavity itself,
 * others for the target pin next to a “Dest” column. The rule: if a Cavity
 * column already exists then “PIN” is the destination; if it does not, “PIN”
 * is the cavity (the historical behaviour).
 */
export function tableColumns(t: Table): TableColumns {
  const idx: TableColumns = {};
  const pins: number[] = [];

  (t.head ?? []).forEach((h, i) => {
    const s = String(h).toLowerCase().trim();
    if (idx.cavity === undefined && /(cavit|cavity|via\b|terminal)/.test(s)) idx.cavity = i;
    if (/\bpin\b|^pin/.test(s) && !/(pn|part)/.test(s)) pins.push(i);
    if (idx.dest === undefined && /(verso|dest|to\b|goes to)/.test(s)) idx.dest = i;
    if (idx.color === undefined && /^(colore|color|colour)$/.test(s)) idx.color = i;
    if (idx.section === undefined && /(sezione|section|gauge|awg|mm²|mm2)/.test(s)) idx.section = i;
    if (idx.func === undefined && /(funzione|function|circuito|circuit|signal)/.test(s)) idx.func = i;
  });

  if (idx.cavity === undefined) {
    // no “Cavity” column: the first “PIN” takes its place, and a second one,
    // if present, stays as the destination pin
    idx.cavity = pins[0];
    if (pins.length > 1) idx.destPin = pins[1];
  } else {
    const pin = pins.find((p) => p !== idx.cavity);
    if (pin !== undefined) idx.destPin = pin;
  }
  return idx;
}

/** A row's destination: target connector and cavity. */
export interface Destination {
  connector: string;
  cavity: string;
}

/**
 * Reads a row's destination, accepting both spellings:
 * “Dest” = `C3.3` (historical format) or “Dest” = `C3` with “PIN” = `3`.
 */
export function resolveDest(row: string[] | undefined, cols: TableColumns): Destination | null {
  const dest = cell(row, cols.dest);
  if (!dest || NOT_CONNECTED_RE.test(dest)) return null;

  const pin = cell(row, cols.destPin);
  if (pin && !NOT_CONNECTED_RE.test(pin)) {
    // with the PIN column filled in, “Dest” holds only the connector name
    const name = DEST_RE.exec(dest)?.[1] ?? dest;
    return NAME_RE.test(name) ? { connector: name, cavity: pin } : null;
  }

  const m = DEST_RE.exec(dest);
  return m?.[1] && m[2] ? { connector: m[1], cavity: m[2] } : null;
}

/** Writes the destination in whichever format the table itself uses. */
export function writeDest(row: string[], cols: TableColumns, dest: Destination): void {
  if (cols.dest === undefined) return;
  const width = Math.max(cols.dest, cols.destPin ?? 0) + 1;
  while (row.length < width) row.push("");
  if (cols.destPin !== undefined) {
    row[cols.dest] = dest.connector;
    row[cols.destPin] = dest.cavity;
  } else {
    row[cols.dest] = `${dest.connector}.${dest.cavity}`;
  }
}

/**
 * Mutual linking is on unless explicitly disabled, so documents written before
 * this feature existed keep behaving the way they used to.
 */
export const isAutoLinkEnabled = (t: Table): boolean => t.autoLink !== false;

/** Name of the connector that owns a cavity table. */
export function ownerName(doc: HarnessDoc, t: Table): string {
  const n = nodeForTable(doc, t);
  if (n?.name) return n.name;
  const m = /^([A-Za-z0-9_+-]+)/.exec(t.title ?? "");
  return m?.[1] ?? "";
}

export interface CavityTable {
  table: Table;
  cols: TableColumns & { cavity: number; dest: number };
  owner: string;
}

/** Tables usable by the check and the wire list: they have Cavity, Dest and an owner. */
export function cavityTables(doc: HarnessDoc): CavityTable[] {
  const out: CavityTable[] = [];
  for (const table of doc.tables) {
    if (table.kind !== "table") continue;
    const cols = tableColumns(table);
    const owner = ownerName(doc, table);
    if (cols.cavity === undefined || cols.dest === undefined || !owner) continue;
    out.push({ table, cols: { ...cols, cavity: cols.cavity, dest: cols.dest }, owner });
  }
  return out;
}

/** Cross-reference "C13.4" → connector + cavity. */
export const DEST_RE = /^([A-Za-z0-9_+-]+)\.([A-Za-z0-9]+)$/;
/** Connector name accepted in the “Dest” column when the cavity lives in “PIN”. */
const NAME_RE = /^[A-Za-z0-9_+-]+$/;
/**
 * Spellings that mean “not connected”. They have to be recognized here and not
 * only in the wire list: otherwise a dash in the “Dest” column would read as
 * the name of a connector that does not exist, and the check would report an
 * error that is not there.
 */
export const NOT_CONNECTED_RE = /^(n\.?c\.?|nc|—|-|–|n\/a|\/)$/i;

export const cell = (row: string[] | undefined, i: number | undefined): string =>
  i === undefined || !row ? "" : String(row[i] ?? "").trim();

/* ============================ Mutations ============================ */

/**
 * Renames a connector, propagating the new name to its table title and to every
 * `NAME.cavity` reference in the other cavity tables. Returns how many
 * references were updated.
 */
export function renameNode(doc: HarnessDoc, node: HNode, newName: string): number {
  const old = node.name.trim();
  const name = newName.trim();
  node.name = name;
  if (!old || old === name) return 0;

  const linked =
    doc.tables.find((t) => t.node === node.id) ??
    doc.tables.find((t) => t.kind === "table" && titleMatchesName(t.title, old));
  if (linked?.title && titleMatchesName(linked.title, old)) {
    linked.title = name + linked.title.slice(old.length);
  }

  let updated = 0;
  if (!name) return updated; // clearing the name would leave broken references: leave them alone
  for (const { table, cols } of cavityTables(doc)) {
    for (const row of table.rows) {
      const dest = resolveDest(row, cols);
      if (dest?.connector !== old) continue;
      writeDest(row, cols, { connector: name, cavity: dest.cavity });
      updated++;
    }
  }
  return updated;
}

/** The connector on the other side of a joint, if this one is half of one. */
export function mateOf(doc: HarnessDoc, nodeId: string): HNode | undefined {
  const mate = findNode(doc, nodeId)?.mate;
  return mate ? findNode(doc, mate) : undefined;
}

/**
 * Joins two connectors into a mated pair, breaking whatever either of them was
 * paired with before. A connector mates with one other, so pairing X with Z
 * when X was already on Y leaves Y free rather than leaving a triangle.
 */
export function mateConnectors(doc: HarnessDoc, aId: string, bId: string): boolean {
  const a = findNode(doc, aId);
  const b = findNode(doc, bId);
  if (!a || !b || a.id === b.id) return false;
  if (nodeDegree(doc, a.id) > 1 || nodeDegree(doc, b.id) > 1) return false;
  if (a.mate === b.id && b.mate === a.id) return false;

  unmateConnector(doc, a.id);
  unmateConnector(doc, b.id);
  a.mate = b.id;
  b.mate = a.id;
  // a joint is between two terminations, so both ends become one
  a.kind = "connector";
  b.kind = "connector";
  normalizeMates(doc);
  return true;
}

/** Breaks a joint, from either side. */
export function unmateConnector(doc: HarnessDoc, nodeId: string): boolean {
  const node = findNode(doc, nodeId);
  if (!node?.mate) return false;
  const other = findNode(doc, node.mate);
  delete node.mate;
  if (other?.mate === nodeId) delete other.mate;
  return true;
}

export function createJunction(doc: HarnessDoc, x: number, y: number): HNode {
  const n: HNode = { id: uid("n"), x, y, kind: "junction", name: "", style: "plug", refs: "" };
  doc.nodes.push(n);
  return n;
}

export function connectNodes(doc: HarnessDoc, a: string, b: string): Segment | null {
  if (a === b) return null;
  const exists = doc.segments.some((s) => (s.a === a && s.b === b) || (s.a === b && s.b === a));
  if (exists) return null;
  const s: Segment = { id: uid("s"), a, b, len: "", refs: "" };
  doc.segments.push(s);
  normalizeConnectors(doc);
  return s;
}

export function addInline(doc: HarnessDoc, segId: string, t: number, text: string): Inline {
  const it: Inline = { id: uid("i"), seg: segId, t: clamp(t, T_MIN, T_MAX), text, color: "#e8942a" };
  doc.inlines.push(it);
  return it;
}

/** Splits a branch by inserting a junction at parametric position t. */
export function splitSegment(doc: HarnessDoc, seg: Segment, t: number): HNode | null {
  const ends = segmentEnds(doc, seg);
  if (!ends) return null;
  const [a, b] = ends;
  const mid = createJunction(doc, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
  doc.segments.push({ id: uid("s"), a: mid.id, b: seg.b, len: "", refs: "" });
  // labels past the cut point move to the new stretch
  const newSeg = doc.segments[doc.segments.length - 1]!;
  for (const it of doc.inlines) {
    if (it.seg !== seg.id) continue;
    if (it.t > t) {
      it.seg = newSeg.id;
      it.t = clamp((it.t - t) / (1 - t), T_MIN, T_MAX);
    } else {
      it.t = clamp(it.t / t, T_MIN, T_MAX);
    }
  }
  seg.b = mid.id;
  normalizeConnectors(doc);
  return mid;
}

/**
 * Merges several nodes into one, which keeps its place on the sheet.
 *
 * This is the way out of the two situations a formboard gets into on its own: a
 * junction drawn twice a few millimetres apart, and two runs that were meant to
 * meet and never quite did. Both look joined and behave as though they are not,
 * because routing follows branches and not proximity — so the fix has to be an
 * edit to the drawing rather than a tolerance in the reader.
 *
 * Branches follow their ends over to the survivor. One that ends up with both
 * ends on it was the branch *between* two of the merged nodes: it has no length
 * left to have, so it goes, and so do its labels. A branch that ends up
 * doubling one already there goes the same way, because two runs between the
 * same pair of nodes are one run drawn twice.
 *
 * The survivor keeps its own name, and takes one only if it has none: merging
 * an unnamed junction into a connector must not cost the connector its
 * identity, and doing it the other way round must not throw the name away.
 *
 * Returns how many nodes disappeared.
 */
export function mergeNodes(doc: HarnessDoc, ids: readonly string[], intoId: string): number {
  const survivor = findNode(doc, intoId);
  if (!survivor) return 0;
  const gone = new Set(ids.filter((id) => id !== intoId && findNode(doc, id)));
  if (!gone.size) return 0;

  // the survivor may be about to inherit an identity, so read it while the
  // nodes it could come from are still there
  const donor = doc.nodes.find((n) => gone.has(n.id) && n.name.trim());

  for (const s of doc.segments) {
    if (gone.has(s.a)) s.a = intoId;
    if (gone.has(s.b)) s.b = intoId;
  }

  const dropped = new Set<string>();
  const pairs = new Set<string>();
  for (const s of doc.segments) {
    const pair = [s.a, s.b].sort().join(" ");
    if (s.a === s.b || pairs.has(pair)) dropped.add(s.id);
    else pairs.add(pair);
  }
  doc.segments = doc.segments.filter((s) => !dropped.has(s.id));
  doc.inlines = doc.inlines.filter((i) => !dropped.has(i.seg));

  if (!survivor.name.trim() && donor) {
    survivor.name = donor.name;
    survivor.kind = donor.kind;
    survivor.style = donor.style;
    if (!survivor.refs.trim()) survivor.refs = donor.refs;
  }

  // A cavity table follows its connector, unless the survivor already has one:
  // two tables claiming one connector would leave the second one silently
  // ignored, so it keeps its place on the sheet and merely stops claiming.
  let taken = doc.tables.some((t) => t.node === intoId);
  for (const table of doc.tables) {
    if (!table.node || !gone.has(table.node)) continue;
    if (taken) delete table.node;
    else {
      table.node = intoId;
      taken = true;
    }
  }

  // a joint the survivor does not already have follows the node it was on
  if (!survivor.mate) {
    const joined = doc.nodes.find((n) => gone.has(n.id) && n.mate && !gone.has(n.mate));
    if (joined?.mate) {
      survivor.mate = joined.mate;
      const other = findNode(doc, joined.mate);
      if (other) other.mate = intoId;
    }
  }

  doc.nodes = doc.nodes.filter((n) => !gone.has(n.id));
  normalizeConnectors(doc);
  normalizeMates(doc);
  return gone.size;
}

/** Deletes an element and everything that depends on it. */
export function deleteEntity(doc: HarnessDoc, type: string, id: string): void {
  if (type === "node") {
    const segIds = new Set(segmentsOf(doc, id).map((s) => s.id));
    doc.inlines = doc.inlines.filter((i) => !segIds.has(i.seg));
    doc.segments = doc.segments.filter((s) => !segIds.has(s.id));
    doc.nodes = doc.nodes.filter((n) => n.id !== id);
    for (const t of doc.tables) if (t.node === id) delete t.node;
  } else if (type === "segment") {
    doc.inlines = doc.inlines.filter((i) => i.seg !== id);
    doc.segments = doc.segments.filter((s) => s.id !== id);
    // junctions left with nothing attached have no meaning any more
    doc.nodes = doc.nodes.filter((n) => n.kind === "connector" || nodeDegree(doc, n.id) > 0);
  } else if (type === "inline") {
    doc.inlines = doc.inlines.filter((i) => i.id !== id);
  } else if (type === "table") {
    doc.tables = doc.tables.filter((t) => t.id !== id);
  }
  normalizeConnectors(doc);
  normalizeMates(doc);
}
