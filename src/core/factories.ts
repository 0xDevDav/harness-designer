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
      t("table.head.dest"),
      t("table.head.pin"),
      t("table.head.notes"),
    ],
    rows: [
      ["1", "", "", "", "", ""],
      ["2", "", "", "", "", ""],
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
