import { addEntry } from "./catalog";
import type { CatalogKind } from "./catalog";
import { uid } from "./ids";
import type { HNode, Table } from "./types";
import type { Translate } from "@/i18n";

/** Generic cavity table, not yet tied to a connector. */
export function cavityTable(t: Translate, x: number, y: number, title?: string): Table {
  return {
    id: uid("t"),
    x,
    y,
    kind: "table",
    title: title ?? t("table.title.connector"),
    // "Dest" and "PIN" kept apart: this is the shape automatic mutual linking
    // works on, filling in the far end of the wire by itself
    head: [
      t("table.head.cavity"),
      t("table.head.color"),
      t("table.head.section"),
      t("table.head.termination"),
      t("table.head.dest"),
      t("table.head.pin"),
      t("table.head.notes"),
    ],
    rows: [
      ["1", "", "", "", "", "", ""],
      ["2", "", "", "", "", "", ""],
    ],
  };
}

/** Cavity table tied to a connector: it is born next to its symbol. */
export function cavityTableFor(t: Translate, node: HNode): Table {
  const table = cavityTable(t, node.x + 60, node.y - 120, node.name || t("table.title.connector"));
  table.node = node.id;
  return table;
}

export function notesTable(t: Translate, x: number, y: number): Table {
  return {
    id: uid("t"),
    x,
    y,
    kind: "table",
    title: t("table.title.notes"),
    head: [t("table.head.num"), t("table.head.note")],
    rows: [
      ["1", t("table.note.build")],
      ["2", t("table.note.continuity")],
    ],
  };
}

export function revisionsTable(t: Translate, x: number, y: number): Table {
  return {
    id: uid("t"),
    x,
    y,
    kind: "table",
    title: t("table.title.revisions"),
    head: [t("table.head.rev"), t("table.head.date"), t("table.head.author"), t("table.head.description")],
    rows: [["A", new Date().toLocaleDateString(), "", t("table.firstIssue")]],
  };
}

export function titleBlock(x: number, y: number): Table {
  return { id: uid("t"), x, y, kind: "title", rows: [] };
}

export const wireListHeadings = (t: Translate): string[] => [
  t("table.head.num"),
  t("table.head.from"),
  t("table.head.to"),
  t("table.head.function"),
  t("table.head.color"),
  t("table.head.section"),
  t("table.head.length"),
];

/** One entry a catalogue starts with: what it is called, and the symbol it is drawn with. */
export interface CatalogSeed {
  name: string;
  symbol: string;
}

/**
 * The housing table or the termination table, with the entries it starts with.
 * Which entries is up to the caller, because they are the symbols the program
 * has registered, which plugins add to and which the core does not know of.
 */
export function catalogTable(
  t: Translate,
  kind: CatalogKind,
  x: number,
  y: number,
  seeds: readonly CatalogSeed[] = [],
): Table {
  const table: Table = {
    id: uid("t"),
    x,
    y,
    kind,
    title: t(kind === "housings" ? "table.title.housings" : "table.title.terminations"),
    head:
      kind === "housings"
        ? [
            t("catalog.head.name"),
            t("catalog.head.cavities"),
            t("meta.partNumber"),
            t("catalog.head.manufacturer"),
            t("catalog.head.series"),
            t("catalog.head.form"),
            t("table.head.description"),
            t("catalog.head.quantity"),
            t("catalog.head.whereUsed"),
          ]
        : [
            t("catalog.head.termination"),
            t("meta.partNumber"),
            t("catalog.head.manufacturer"),
            t("table.head.description"),
            t("catalog.head.quantity"),
            t("catalog.head.whereUsed"),
          ],
    rows: [],
  };
  for (const seed of seeds) addEntry(table, { name: seed.name }, seed.symbol);
  return table;
}
