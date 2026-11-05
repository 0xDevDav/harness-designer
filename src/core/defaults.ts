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

/** A wire's row in a cavity table, with where its columns are. */
export interface WireRow {
  row: string[];
  cols: TableColumns;
}

/** Nothing written, or a dash standing for it. */
const blank = (row: string[], col: number): boolean => {
  const written = String(row[col] ?? "").trim();
  return !written || NOT_CONNECTED_RE.test(written);
};

/**
 * Starts a new wire from the defaults: its colour, size and type, for each one
 * that neither end says anything about, or has a dash for. A property that
 * either end already has is left as it is, so the two ends never disagree and
 * nothing written is changed. `far` is the cavity at the other end, when it has
 * a table; it is given the same values. Mutates the rows.
 *
 * This is for a wire that has just been made, and only then: a wire that is
 * already there, whose cell was left empty on purpose, is not to be filled
 * again by a later edit.
 */
export function applyWireDefaults(
  near: WireRow,
  far: WireRow | null,
  defaults: WireDefaults | undefined,
): void {
  if (!defaults) return;
  const props = [
    ["color", defaults.color],
    ["section", defaults.size],
    ["type", defaults.type],
  ] as const;
  for (const [prop, value] of props) {
    if (!value) continue;
    const sides = [near, far].flatMap((side) => {
      const col = side?.cols[prop];
      return side && col !== undefined ? [{ row: side.row, col }] : [];
    });
    if (!sides.length || !sides.every((side) => blank(side.row, side.col))) continue;
    for (const { row, col } of sides) {
      while (row.length <= col) row.push("");
      row[col] = value;
    }
  }
}
