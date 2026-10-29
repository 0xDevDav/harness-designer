import { findInline, findNode, findSegment, findTable, renameNode } from "./doc";
import type { DocMeta, HarnessDoc } from "./types";

/**
 * Find and replace over everything in the drawing that is text somebody typed.
 *
 * Pure functions on the document, so the panel is only a way of asking: what
 * matches, which one is current, change this one, change them all.
 */

const META_FIELDS = ["title", "description", "partNumber", "revision", "company", "drawnBy", "date"] as const;
export type MetaField = (typeof META_FIELDS)[number];

/** One piece of text in the drawing, addressed by what it belongs to. */
export type FindTarget =
  | { kind: "title"; table: string }
  | { kind: "head"; table: string; col: number }
  | { kind: "cell"; table: string; row: number; col: number }
  | { kind: "connector"; node: string }
  | { kind: "length"; segment: string }
  | { kind: "label"; inline: string }
  | { kind: "meta"; field: MetaField };

export interface FindOptions {
  matchCase: boolean;
  /** the whole text has to be the query, not just contain it (a whole cell, name, label) */
  whole: boolean;
}

export const DEFAULT_FIND_OPTIONS: FindOptions = { matchCase: false, whole: false };

const fold = (s: string, o: FindOptions): string => (o.matchCase ? s : s.toLowerCase());

export function matches(text: string, query: string, o: FindOptions): boolean {
  if (!query) return false;
  return o.whole ? fold(text.trim(), o) === fold(query, o) : fold(text, o).includes(fold(query, o));
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The text with the query replaced. The replacement is literal: `$1` is just `$1`. */
export function replaceInText(text: string, query: string, replacement: string, o: FindOptions): string {
  if (!query) return text;
  if (o.whole) return matches(text, query, o) ? replacement : text;
  return text.replace(new RegExp(escapeRegExp(query), o.matchCase ? "g" : "gi"), () => replacement);
}

/** What the target says right now, or undefined if what it points at is gone. */
export function textOf(doc: HarnessDoc, target: FindTarget): string | undefined {
  switch (target.kind) {
    case "title":
      return findTable(doc, target.table)?.title;
    case "head":
      return findTable(doc, target.table)?.head?.[target.col];
    case "cell":
      return findTable(doc, target.table)?.rows[target.row]?.[target.col];
    case "connector":
      return findNode(doc, target.node)?.name;
    case "length":
      return findSegment(doc, target.segment)?.len;
    case "label":
      return findInline(doc, target.inline)?.text;
    case "meta":
      return doc.meta[target.field];
  }
}

/** Writes text into the target. False when the target is gone or refuses the text. */
function setText(doc: HarnessDoc, target: FindTarget, value: string): boolean {
  switch (target.kind) {
    case "title": {
      const table = findTable(doc, target.table);
      if (!table) return false;
      table.title = value;
      return true;
    }
    case "head": {
      const head = findTable(doc, target.table)?.head;
      if (!head || target.col >= head.length) return false;
      head[target.col] = value;
      return true;
    }
    case "cell": {
      const row = findTable(doc, target.table)?.rows[target.row];
      if (!row) return false;
      while (row.length <= target.col) row.push("");
      row[target.col] = value;
      return true;
    }
    case "connector": {
      const node = findNode(doc, target.node);
      const name = value.trim();
      // a connector with no name, or the name of another one, would break every
      // reference to it: that replacement is refused rather than half done
      if (!node || !name || doc.nodes.some((n) => n.id !== node.id && n.name === name)) return false;
      // renaming also carries the new name into the table title and every
      // `NAME.cavity` that pointed at it
      renameNode(doc, node, name);
      return true;
    }
    case "length": {
      const segment = findSegment(doc, target.segment);
      if (!segment) return false;
      segment.len = value;
      return true;
    }
    case "label": {
      const inline = findInline(doc, target.inline);
      if (!inline) return false;
      inline.text = value;
      return true;
    }
    case "meta":
      doc.meta[target.field satisfies keyof DocMeta] = value;
      return true;
  }
}

/** Every match, in reading order: the tables as they come, then connectors, branches, labels, title block. */
export function findAll(doc: HarnessDoc, query: string, options: FindOptions): FindTarget[] {
  const hits: FindTarget[] = [];
  if (!query) return hits;
  const test = (text: string | undefined): boolean => text !== undefined && matches(text, query, options);

  for (const table of doc.tables) {
    if (table.kind !== "table") continue;
    if (test(table.title)) hits.push({ kind: "title", table: table.id });
    table.head?.forEach((heading, col) => {
      if (test(heading)) hits.push({ kind: "head", table: table.id, col });
    });
    table.rows.forEach((row, r) =>
      row.forEach((value, col) => {
        if (test(value)) hits.push({ kind: "cell", table: table.id, row: r, col });
      }),
    );
  }
  for (const node of doc.nodes) {
    if (node.kind === "connector" && test(node.name)) hits.push({ kind: "connector", node: node.id });
  }
  for (const segment of doc.segments) {
    if (test(segment.len)) hits.push({ kind: "length", segment: segment.id });
  }
  for (const inline of doc.inlines) {
    if (test(inline.text)) hits.push({ kind: "label", inline: inline.id });
  }
  for (const field of META_FIELDS) {
    if (test(doc.meta[field])) hits.push({ kind: "meta", field });
  }
  return hits;
}

/** Replaces the query in one target. True if the drawing changed. */
export function replaceAt(
  doc: HarnessDoc,
  target: FindTarget,
  query: string,
  replacement: string,
  options: FindOptions,
): boolean {
  const before = textOf(doc, target);
  if (before === undefined) return false;
  const after = replaceInText(before, query, replacement, options);
  if (after === before) return false;
  return setText(doc, target, after);
}

export interface ReplaceResult {
  /** places that changed, the references a rename carried along included */
  changed: number;
  /** places left as they were because the connector they belong to could not be renamed */
  held: number;
}

/** What every table title and cell says, by where it is, so a pass can tell what it changed. */
function textsOfTables(doc: HarnessDoc): Map<string, string> {
  const out = new Map<string, string>();
  for (const table of doc.tables) {
    out.set(`${table.id}|t`, table.title ?? "");
    table.rows.forEach((row, r) => row.forEach((value, c) => out.set(`${table.id}|${r}|${c}`, value)));
  }
  return out;
}

const textKey = (target: FindTarget): string | null =>
  target.kind === "title"
    ? `${target.table}|t`
    : target.kind === "cell"
      ? `${target.table}|${target.row}|${target.col}`
      : null;

/**
 * Replaces the query everywhere it was found.
 *
 * Connectors go first. Renaming one rewrites its table title and every
 * reference to it, and the rename can be refused (the name is taken, or would be
 * empty): when it is, the references to that connector keep the name it still
 * has, or they would end up pointing at some other connector.
 *
 * A title or cell that the renames already rewrote is not replaced in again:
 * with a new name that contains the old one, `MAP.3` would go to `MAPX.3` and
 * then, still finding `MAP`, to `MAPXX.3`. They are counted instead, so the
 * number of places changed is what changed.
 */
export function replaceAll(
  doc: HarnessDoc,
  query: string,
  replacement: string,
  options: FindOptions,
): ReplaceResult {
  const hits = findAll(doc, query, options);
  const result: ReplaceResult = { changed: 0, held: 0 };
  /** connectors that kept their name, by name, with the id of the node */
  const kept = new Map<string, string>();
  const was = textsOfTables(doc);

  for (const target of hits) {
    if (target.kind !== "connector") continue;
    const before = textOf(doc, target);
    if (before === undefined) continue;
    if (replaceAt(doc, target, query, replacement, options)) result.changed++;
    else if (replaceInText(before, query, replacement, options) !== before) {
      kept.set(before.trim(), target.node);
      result.held++;
    }
  }

  // what the renames rewrote on their way: the titles and references of the connectors
  const now = textsOfTables(doc);
  const carried = new Set<string>();
  for (const [key, text] of now) if (was.get(key) !== text) carried.add(key);
  result.changed += carried.size;

  const pointsAtKept = (target: FindTarget): boolean => {
    if (!kept.size) return false;
    if (target.kind === "title") return [...kept.values()].includes(findTable(doc, target.table)?.node ?? "");
    if (target.kind !== "cell") return false;
    const text = (textOf(doc, target) ?? "").trim();
    return [...kept.keys()].some((name) => text === name || text.startsWith(`${name}.`));
  };

  for (const target of hits) {
    if (target.kind === "connector") continue;
    const key = textKey(target);
    if (key && carried.has(key)) continue;
    if (pointsAtKept(target)) {
      if (textOf(doc, target) !== undefined) result.held++;
      continue;
    }
    if (replaceAt(doc, target, query, replacement, options)) result.changed++;
  }
  return result;
}

/**
 * The key a table cell, heading or title is marked by on the sheet.
 * Other kinds of target have no place inside a table and so no key.
 */
export function cellKey(target: FindTarget): string | null {
  switch (target.kind) {
    case "title":
      return "t";
    case "head":
      return `h:${target.col}`;
    case "cell":
      return `r:${target.row}:${target.col}`;
    default:
      return null;
  }
}

/** The table a target sits in, if it sits in one. */
export const tableOfTarget = (target: FindTarget): string | null =>
  target.kind === "title" || target.kind === "head" || target.kind === "cell" ? target.table : null;
