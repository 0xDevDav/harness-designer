import { cell, ownerName, tableColumns, tableForNode } from "./doc";
import type { HarnessDoc, Table } from "./types";

/**
 * The two catalogues a drawing keeps of what its connectors are made of.
 *
 * A housing is the plastic: the shell with its cavities, which a connector is
 * built on. A termination is the metal: the contact crimped on the end of a
 * wire, which sits in one cavity. They are kept apart because they vary
 * independently — one housing takes several sizes of contact, and one relay is
 * wired with two sizes of faston — so a connector's cavity table points at one
 * housing, and each of its rows points at its own termination.
 *
 * Both are ordinary tables on the sheet. What the cavity tables say about them
 * is by name, and the two columns that count the uses (`quantity`, `whereUsed`)
 * are not typed: `syncCatalogs` writes them after every edit from what the
 * cavity tables say, so they are always right and print like any other cell.
 */

export const CATALOG_KINDS = ["housings", "terminations"] as const;
export type CatalogKind = (typeof CATALOG_KINDS)[number];

/** What each column of a housing table holds, in order. The columns are found by place, not by heading. */
export const HOUSING_FIELDS = [
  "name",
  "cavities",
  "partNumber",
  "manufacturer",
  "series",
  "form",
  "description",
  "quantity",
  "whereUsed",
] as const;

export const TERMINATION_FIELDS = [
  "name",
  "partNumber",
  "manufacturer",
  "description",
  "quantity",
  "whereUsed",
] as const;

export type CatalogField = (typeof HOUSING_FIELDS)[number] | (typeof TERMINATION_FIELDS)[number];

export const catalogFields = (kind: CatalogKind): readonly CatalogField[] =>
  kind === "housings" ? HOUSING_FIELDS : TERMINATION_FIELDS;

export const catalogWidth = (kind: CatalogKind): number => catalogFields(kind).length;

export const isCatalog = (table: Table): table is Table & { kind: CatalogKind } =>
  table.kind === "housings" || table.kind === "terminations";

/** The column a field sits in, or -1. */
export const fieldColumn = (kind: CatalogKind, field: CatalogField): number =>
  catalogFields(kind).indexOf(field);

/** Quantity and where-used are worked out, so they are never typed. */
export const isDerivedColumn = (kind: CatalogKind, col: number): boolean => {
  const field = catalogFields(kind)[col];
  return field === "quantity" || field === "whereUsed";
};

/** The housing table or the termination table, if the drawing has one. */
export const catalogOf = (doc: HarnessDoc, kind: CatalogKind): Table | undefined =>
  doc.tables.find((t) => t.kind === kind);

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The row an entry is on, by name; names are compared the way a person would, without case or padding. */
export function entryRow(table: Table, name: string): number {
  if (!name.trim()) return -1;
  return table.rows.findIndex((row) => same(row[0] ?? "", name));
}

export const entryNames = (table: Table): string[] =>
  table.rows.map((row) => (row[0] ?? "").trim()).filter(Boolean);

/* ============================ who uses what ============================ */

export interface Usage {
  /** housings: connectors using it; terminations: cavities using it */
  count: number;
  /** the connectors, each once, in the order they come on the sheet */
  owners: string[];
}

const ownerLabel = (doc: HarnessDoc, table: Table): string =>
  ownerName(doc, table) || (table.title ?? "").trim() || "?";

/** The cavity tables that can name a housing or terminations: the ordinary tables. */
const cavityLike = (doc: HarnessDoc): Table[] => doc.tables.filter((t) => t.kind === "table");

/** The uses of every entry of a catalogue at once, keyed by lower-case name. */
export function usageMap(doc: HarnessDoc, kind: CatalogKind): Map<string, Usage> {
  const out = new Map<string, Usage>();
  const note = (name: string, owner: string): void => {
    const key = name.trim().toLowerCase();
    if (!key) return;
    const usage = out.get(key) ?? { count: 0, owners: [] };
    usage.count++;
    if (!usage.owners.includes(owner)) usage.owners.push(owner);
    out.set(key, usage);
  };

  for (const table of cavityLike(doc)) {
    if (kind === "housings") {
      if (table.housing) note(table.housing, ownerLabel(doc, table));
      continue;
    }
    const col = tableColumns(table).termination;
    if (col === undefined) continue;
    const owner = ownerLabel(doc, table);
    for (const row of table.rows) note(cell(row, col), owner);
  }
  return out;
}

export function usageOf(doc: HarnessDoc, kind: CatalogKind, name: string): Usage {
  return usageMap(doc, kind).get(name.trim().toLowerCase()) ?? { count: 0, owners: [] };
}

/** How many assignments the whole catalogue holds, for the question asked before it is deleted. */
export function totalUsage(doc: HarnessDoc, kind: CatalogKind): Usage {
  const all: Usage = { count: 0, owners: [] };
  for (const usage of usageMap(doc, kind).values()) {
    all.count += usage.count;
    for (const owner of usage.owners) if (!all.owners.includes(owner)) all.owners.push(owner);
  }
  return all;
}

/* ============================ editing ============================ */

/** Takes every use of an entry away: a cavity table loses its housing, a cavity its termination. */
export function unassignEntry(doc: HarnessDoc, kind: CatalogKind, name: string): void {
  for (const table of cavityLike(doc)) {
    if (kind === "housings") {
      if (table.housing && same(table.housing, name)) delete table.housing;
      continue;
    }
    const col = tableColumns(table).termination;
    if (col === undefined) continue;
    for (const row of table.rows) if (same(cell(row, col), name)) row[col] = "";
  }
}

/** Renames an entry and everything that points at it, so nothing is left naming a thing that is gone. */
export function renameEntry(doc: HarnessDoc, table: Table, from: string, to: string): void {
  if (!isCatalog(table) || !from.trim() || same(from, to)) return;
  for (const other of cavityLike(doc)) {
    if (table.kind === "housings") {
      if (other.housing && same(other.housing, from)) other.housing = to.trim();
      continue;
    }
    const col = tableColumns(other).termination;
    if (col === undefined) continue;
    for (const row of other.rows) if (same(cell(row, col), from)) row[col] = to.trim();
  }
  if (table.symbols) {
    const key = Object.keys(table.symbols).find((k) => same(k, from));
    if (key !== undefined) {
      const symbol = table.symbols[key];
      delete table.symbols[key];
      if (symbol && to.trim()) table.symbols[to.trim()] = symbol;
    }
  }
}

/** Whether a row may be called `name`: there has to be one, and no other row may already have it. */
export function nameIsFree(table: Table, name: string, row = -1): boolean {
  if (!name.trim()) return false;
  return !table.rows.some((r, i) => i !== row && same(r[0] ?? "", name));
}

/**
 * Deletes a row of a catalogue, letting go of everything that used it first.
 * Returns what it let go of, which is what the question before it quoted.
 */
export function removeEntry(doc: HarnessDoc, table: Table, row: number): Usage {
  const none: Usage = { count: 0, owners: [] };
  if (!isCatalog(table) || row < 0 || row >= table.rows.length) return none;
  const name = (table.rows[row]?.[0] ?? "").trim();
  const usage = name ? usageOf(doc, table.kind, name) : none;
  if (name) unassignEntry(doc, table.kind, name);
  table.rows.splice(row, 1);
  if (name && table.symbols) {
    const key = Object.keys(table.symbols).find((k) => same(k, name));
    if (key !== undefined) delete table.symbols[key];
    if (!Object.keys(table.symbols).length) delete table.symbols;
  }
  return usage;
}

/** What a new entry is given. Quantity and where-used are not here: they are worked out. */
export type EntryValues = Partial<Record<Exclude<CatalogField, "quantity" | "whereUsed">, string>>;

/** Adds an entry to the end of a catalogue. Returns its row, or -1 when its name is missing or taken. */
export function addEntry(table: Table, values: EntryValues, symbol?: string): number {
  if (!isCatalog(table)) return -1;
  const name = (values.name ?? "").trim();
  if (!nameIsFree(table, name)) return -1;

  const row = catalogFields(table.kind).map((field) => {
    const value = (values as Record<string, string | undefined>)[field];
    return field === "quantity" ? "0" : (value ?? "").trim();
  });
  table.rows.push(row);
  if (symbol) (table.symbols ??= {})[name] = symbol;
  return table.rows.length - 1;
}

/* ============================ keeping it true ============================ */

/**
 * The symbol a connector is drawn with, when its cavity table says what it is
 * made of: the symbol of its housing, or, with none, of the first contact it
 * names. `undefined` when the table says nothing, which leaves the connector
 * drawn as it was.
 */
export function symbolFor(doc: HarnessDoc, table: Table): string | undefined {
  const housings = catalogOf(doc, "housings");
  if (table.housing && housings) {
    const at = entryRow(housings, table.housing);
    if (at >= 0) return symbolOf(housings, housings.rows[at]?.[0] ?? "") ?? "plug";
  }
  const terminations = catalogOf(doc, "terminations");
  const col = tableColumns(table).termination;
  if (terminations && col !== undefined) {
    for (const row of table.rows) {
      const at = entryRow(terminations, cell(row, col));
      if (at >= 0) return symbolOf(terminations, terminations.rows[at]?.[0] ?? "") ?? "pin";
    }
  }
  return undefined;
}

function symbolOf(table: Table, name: string): string | undefined {
  const key = Object.keys(table.symbols ?? {}).find((k) => same(k, name));
  return key === undefined ? undefined : table.symbols?.[key];
}

/**
 * Brings everything worked out from the cavity tables up to date, and is cheap
 * enough to run after every edit (the store does).
 *
 * - A cavity table whose housing is no longer in the housing table has none.
 * - Quantity and where-used are rewritten from what the cavity tables say.
 * - A catalogue symbol kept for a name no row has any more is let go.
 * - A connector is drawn with the symbol its cavity table asks for.
 *
 * A termination named in a cavity that no row of the termination table has is
 * left alone, though: that cell is what somebody typed, and quietly emptying it
 * would lose it. It simply counts for nothing.
 */
export function syncCatalogs(doc: HarnessDoc): void {
  const housings = catalogOf(doc, "housings");
  for (const table of cavityLike(doc)) {
    if (table.housing === undefined) continue;
    const at = housings ? entryRow(housings, table.housing) : -1;
    if (at < 0) delete table.housing;
    else table.housing = (housings?.rows[at]?.[0] ?? "").trim();
  }

  for (const kind of CATALOG_KINDS) {
    const table = catalogOf(doc, kind);
    if (!table) continue;
    const usage = usageMap(doc, kind);
    const quantity = fieldColumn(kind, "quantity");
    const whereUsed = fieldColumn(kind, "whereUsed");
    const width = catalogWidth(kind);
    for (const row of table.rows) {
      while (row.length < width) row.push("");
      const used = usage.get((row[0] ?? "").trim().toLowerCase());
      row[quantity] = String(used?.count ?? 0);
      row[whereUsed] = used?.owners.join(", ") ?? "";
    }
    if (table.symbols) {
      for (const key of Object.keys(table.symbols)) {
        if (entryRow(table, key) < 0) delete table.symbols[key];
      }
      if (!Object.keys(table.symbols).length) delete table.symbols;
    }
  }

  for (const node of doc.nodes) {
    if (node.kind !== "connector" || node.style === "splice") continue;
    const table = tableForNode(doc, node.id);
    if (!table || table.kind !== "table") continue;
    const symbol = symbolFor(doc, table);
    if (symbol && node.style !== symbol) node.style = symbol;
  }
}

/** Whether any cavity of the table names a termination, whether or not the termination table has it. */
export function namesATermination(table: Table): boolean {
  const col = tableColumns(table).termination;
  return col !== undefined && table.rows.some((row) => cell(row, col) !== "");
}

/* ============================ housings and their cavities ============================ */

/** How many cavities a housing has, when its row says: a blank or a non-number says nothing. */
export function housingCavities(doc: HarnessDoc, name: string): number | undefined {
  const housings = catalogOf(doc, "housings");
  const at = housings ? entryRow(housings, name) : -1;
  const value = at < 0 ? "" : (housings?.rows[at]?.[fieldColumn("housings", "cavities")] ?? "").trim();
  const n = /^\d+$/.test(value) ? Number.parseInt(value, 10) : 0;
  return n > 0 ? n : undefined;
}

export interface Fitted {
  added: number;
  removed: number;
  /** rows still over the count, because something is written in them */
  over: number;
}

/**
 * Makes a cavity table as long as its housing has cavities.
 *
 * Short, it grows, numbering the new rows on from the last. Long, it loses
 * rows from the end for as long as they are empty, and stops at the first one
 * with anything in it: a cavity somebody has wired is theirs to take out, and
 * `over` says how many rows are left past the housing's count.
 */
export function fitCavityRows(table: Table, count: number): Fitted {
  const cavity = tableColumns(table).cavity;
  const none: Fitted = { added: 0, removed: 0, over: 0 };
  if (table.kind !== "table" || cavity === undefined) return none;

  const width = Math.max(table.head?.length ?? 0, ...table.rows.map((r) => r.length), 1);
  const empty = (row: string[]): boolean => row.every((c, i) => i === cavity || c.trim() === "");

  let added = 0;
  while (table.rows.length < count) {
    const row = new Array<string>(width).fill("");
    row[cavity] = String(table.rows.length + 1);
    table.rows.push(row);
    added++;
  }
  let removed = 0;
  while (table.rows.length > count) {
    const last = table.rows[table.rows.length - 1];
    if (!last || !empty(last)) break;
    table.rows.pop();
    removed++;
  }
  return { added, removed, over: Math.max(0, table.rows.length - count) };
}

/**
 * Which of the contacts a cavity table uses are pins and which are sockets, by
 * the symbol each termination is drawn with. Both in one connector is a mistake
 * a drawing is better told about than left to a crimper to find.
 */
export function contactGenders(doc: HarnessDoc, table: Table): { pins: boolean; sockets: boolean } {
  const terminations = catalogOf(doc, "terminations");
  const col = tableColumns(table).termination;
  const out = { pins: false, sockets: false };
  if (!terminations || col === undefined) return out;
  for (const row of table.rows) {
    const at = entryRow(terminations, cell(row, col));
    const symbol = at < 0 ? undefined : symbolOf(terminations, terminations.rows[at]?.[0] ?? "");
    if (symbol === "pin") out.pins = true;
    if (symbol === "socket") out.sockets = true;
  }
  return out;
}
