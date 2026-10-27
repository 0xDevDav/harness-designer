import { NOT_CONNECTED_RE } from "./doc";
import type { TableColumns } from "./doc";
import type { HarnessDoc, WireDefaults } from "./types";

/**
 * What a new wire starts with.
 *
 * They are only ever filled into what is empty: a defaults setting is a place to
 * start from, and nothing somebody has written is changed by it. It is kept in
 * the drawing, because a harness is usually built from one kind of wire and the
 * next person to open the file should get the same starting point.
 */

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Defaults read from a file: trimmed, and absent when there is nothing in them. */
export function normalizeDefaults(raw: unknown): WireDefaults | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const src = raw as Record<string, unknown>;
  const defaults: WireDefaults = {
    color: text(src["color"]),
    size: text(src["size"]),
    type: text(src["type"]),
  };
  return defaults.color || defaults.size || defaults.type ? defaults : undefined;
}

/** Changes the wire defaults, leaving the document without any when none is left. Mutates the document. */
export function setDefaults(
  doc: HarnessDoc,
  patch: Partial<Pick<WireDefaults, "color" | "size" | "type">>,
): void {
  const kept = normalizeDefaults({ color: "", size: "", type: "", ...doc.defaults, ...patch });
  if (kept) doc.defaults = kept;
  else delete doc.defaults;
}

/** Fills the colour, size and type a wire row has none of, or has a dash for, with the defaults. Mutates the row. */
export function applyWireDefaults(
  row: string[],
  cols: TableColumns,
  defaults: WireDefaults | undefined,
): void {
  if (!defaults) return;
  const wanted: ReadonlyArray<readonly [number | undefined, string]> = [
    [cols.color, defaults.color],
    [cols.section, defaults.size],
    [cols.type, defaults.type],
  ];
  for (const [col, value] of wanted) {
    if (col === undefined || !value) continue;
    // a dash is a cell with nothing in it, as it is everywhere else in the tables
    const written = String(row[col] ?? "").trim();
    if (written && !NOT_CONNECTED_RE.test(written)) continue;
    while (row.length <= col) row.push("");
    row[col] = value;
  }
}
