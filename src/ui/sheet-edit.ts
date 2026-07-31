import type { AppContext } from "@/app/context";
import { autoLinkRow, rowHasDestination } from "@/core/autolink";
import {
  findInline,
  findNode,
  findSegment,
  findTable,
  isAutoLinkEnabled,
  renameNode,
  segmentEnds,
  tableColumns,
} from "@/core/doc";
import { lerpPoint } from "@/core/geometry";
import type { HarnessDoc, Point, Rect, Selection, Table } from "@/core/types";
import { HEAD_ROW, ROW_H, TITLE_ROW, cellAt, cellRect, titleBlockLayout } from "@/render/tables";
import { textWidth } from "@/render/svg";
import { openColorPicker } from "./colorpicker";
import { openInlineEditor } from "./inline-edit";

/**
 * Editing straight on the sheet.
 *
 * This module is what took the properties panel's place: it turns a double
 * click on a drawing element into the right editor, and takes care of what the
 * panel used to do implicitly, namely recording the change as a single undo
 * step and firing mutual linking when a table row changes.
 */

/** Target of an in-place edit. */
export interface EditTarget {
  selection: Selection;
  /** table row: an index, or TITLE_ROW / HEAD_ROW */
  row?: number;
  col?: number;
  /** the document point that was hit, used to work out the cell when the DOM is not enough */
  world?: Point;
}

/** Works out the target from the SVG element under the pointer. */
export function editTargetFrom(element: Element | null): EditTarget | null {
  const owner = element?.closest<SVGElement>("[data-ent]");
  if (!owner) return null;
  const type = owner.dataset["ent"];
  const id = owner.dataset["id"];
  if (!id || (type !== "node" && type !== "segment" && type !== "inline" && type !== "table")) return null;

  const target: EditTarget = { selection: { type, id } };
  const row = owner.dataset["row"];
  const col = owner.dataset["col"];
  if (row !== undefined) target.row = Number.parseInt(row, 10);
  if (col !== undefined) target.col = Number.parseInt(col, 10);
  return target;
}

/** Opens the editor suited to the given element. Returns false if it cannot be edited here. */
export function editOnSheet(app: AppContext, target: EditTarget): boolean {
  const { selection } = target;
  app.store.select(selection);

  switch (selection.type) {
    case "table": {
      const table = findTable(app.store.doc, selection.id);
      if (!table) return false;

      // the title block has no cells: the field is chosen from where the click landed
      if (table.kind === "title") {
        return editTitleBlock(app, table, target.world ? titleFieldAt(app, table, target.world) : 0);
      }

      let { row, col } = target;
      // if the event does not carry the cell, work it out from the position
      if ((row === undefined || col === undefined) && target.world) {
        const hit = cellAt(table, target.world);
        if (hit) {
          row = hit.row;
          col = hit.col;
        }
      }
      // with no cell identified nothing opens: the double click may have landed
      // outside the table that is still selected
      if (row === undefined || col === undefined) return false;
      return editTable(app, selection.id, row, col);
    }
    case "inline":
      return editInline(app, selection.id);
    case "segment":
      return editSegment(app, selection.id);
    case "node":
      return editNode(app, selection.id);
    default:
      return false;
  }
}

/* ---------------- tables ---------------- */

function editTable(app: AppContext, id: string, row?: number, col?: number): boolean {
  const table = findTable(app.store.doc, id);
  if (!table) return false;
  if (table.kind === "title") return editTitleBlock(app, table, col ?? 0);
  if (row === undefined || col === undefined) return false;

  const rect = cellRect(table, row, col);
  if (!rect) return false;

  // the colour column is picked from the palette, not typed
  const colorCol = tableColumns(table).color;
  if (row >= 0 && col === colorCol) {
    openColorPickerOnSheet(app, table, row, col);
    return true;
  }

  openInlineEditor({
    rect,
    value: readCell(table, row, col),
    fontSize: row === TITLE_ROW ? 12 : 11,
    align: row === TITLE_ROW ? "center" : "left",
    onCommit: (value, next) => {
      commitCell(app, id, row, col, value);
      const step = nextCell(app.store.doc, id, row, col, next);
      if (step) editTable(app, id, step.row, step.col);
    },
  });
  return true;
}

const readCell = (table: Table, row: number, col: number): string => {
  if (row === TITLE_ROW) return table.title ?? "";
  if (row === HEAD_ROW) return table.head?.[col] ?? "";
  return table.rows[row]?.[col] ?? "";
};

function commitCell(app: AppContext, id: string, row: number, col: number, value: string): void {
  const changed = app.store.edit((doc) => {
    const table = findTable(doc, id);
    if (!table) return;
    if (row === TITLE_ROW) {
      table.title = value;
      return;
    }
    if (row === HEAD_ROW) {
      const head = table.head ?? (table.head = []);
      while (head.length <= col) head.push("");
      head[col] = value;
      return;
    }
    const cells = table.rows[row];
    if (!cells) return;
    while (cells.length <= col) cells.push("");
    cells[col] = value;
  }, "cell");

  if (changed && row >= 0) runAutoLink(app, id, row);
}

/** Mutual linking after a row is edited, along with its feedback. */
export function runAutoLink(app: AppContext, tableId: string, rowIndex: number): void {
  const { t } = app;
  const table = findTable(app.store.doc, tableId);
  if (!table || table.kind !== "table" || !isAutoLinkEnabled(table)) return;
  if (!rowHasDestination(table, rowIndex)) return;

  let status = "no-destination";
  let to = "";
  let conflictWith = "";
  let fields: string[] = [];
  app.store.edit((doc) => {
    const result = autoLinkRow(doc, tableId, rowIndex);
    status = result.status;
    to = result.to ?? "";
    conflictWith = result.conflictWith ?? "";
    fields = (result.updatedFields ?? []).map((f) =>
      t(f === "color" ? "table.head.color" : "table.head.section"),
    );
  }, "autolink");

  if (status === "linked") app.toast.show(t("toast.autoLinked", { target: to }));
  else if (status === "updated") {
    app.toast.show(t("toast.autoLinkUpdated", { target: to, fields: fields.join(", ") }));
  } else if (status === "conflict") {
    app.toast.error(t("toast.autoLinkConflict", { target: to, other: conflictWith }));
  }
}

/** The next cell for the key pressed, which is what makes a pin-out fillable. */
function nextCell(
  doc: HarnessDoc,
  id: string,
  row: number,
  col: number,
  step: "none" | "forward" | "back" | "up" | "down",
): { row: number; col: number } | null {
  if (step === "none") return null;
  const table = findTable(doc, id);
  if (!table || table.kind === "title") return null;
  const columns = Math.max(table.head?.length ?? 0, ...table.rows.map((r) => r.length), 1);
  const lastRow = table.rows.length - 1;

  if (step === "up") return row > 0 ? { row: row - 1, col } : null;
  if (step === "down") return row < lastRow ? { row: row + 1, col } : null;

  if (step === "forward") {
    if (col < columns - 1) return { row, col: col + 1 };
    return row < lastRow ? { row: row + 1, col: 0 } : null;
  }
  if (col > 0) return { row, col: col - 1 };
  return row > 0 ? { row: row - 1, col: columns - 1 } : null;
}

function openColorPickerOnSheet(app: AppContext, table: Table, row: number, col: number): void {
  openColorPicker({
    value: readCell(table, row, col),
    onPick: (value) => commitCell(app, table.id, row, col, value),
  });
}

/* ---------------- title block ---------------- */

/** The title block fields, in the order they appear in the box. */
const TITLE_FIELDS = ["title", "description", "partNumber", "revision", "drawnBy", "company"] as const;
type TitleField = (typeof TITLE_FIELDS)[number];

/**
 * The title block field under the given point: the box is split into three
 * columns, with the middle one split into three stacked cells.
 */
function titleFieldAt(app: AppContext, table: Table, point: Point): number {
  const layout = titleBlockLayout(app.store.doc.meta, app.t);
  const x = point.x - table.x;
  const y = point.y - table.y;
  if (x > layout.X2) return TITLE_FIELDS.indexOf("company");
  if (x > layout.X1) {
    const third = Math.floor((y / layout.H) * 3);
    if (third <= 0) return TITLE_FIELDS.indexOf("partNumber");
    if (third === 1) return TITLE_FIELDS.indexOf("revision");
    return TITLE_FIELDS.indexOf("drawnBy");
  }
  return y < ROW_H * 2 ? TITLE_FIELDS.indexOf("title") : TITLE_FIELDS.indexOf("description");
}

function editTitleBlock(app: AppContext, table: Table, index: number): boolean {
  const meta = app.store.doc.meta;
  const layout = titleBlockLayout(meta, app.t);
  const field = TITLE_FIELDS[Math.max(0, Math.min(TITLE_FIELDS.length - 1, index))] ?? "title";

  const rects: Record<TitleField, Rect> = {
    title: { x: table.x + 2, y: table.y + 10, w: layout.X1 - 4, h: ROW_H },
    description: { x: table.x + 2, y: table.y + ROW_H * 2 + 10, w: layout.X1 - 4, h: ROW_H },
    partNumber: { x: table.x + layout.X1 + 2, y: table.y + 8, w: layout.X2 - layout.X1 - 4, h: ROW_H },
    revision: {
      x: table.x + layout.X1 + 2,
      y: table.y + layout.H / 3 + 8,
      w: layout.X2 - layout.X1 - 4,
      h: ROW_H,
    },
    drawnBy: {
      x: table.x + layout.X1 + 2,
      y: table.y + (layout.H / 3) * 2 + 8,
      w: layout.X2 - layout.X1 - 4,
      h: ROW_H,
    },
    company: {
      x: table.x + layout.X2 + 2,
      y: table.y + layout.H / 2 - 8,
      w: layout.W - layout.X2 - 4,
      h: ROW_H,
    },
  };

  openInlineEditor({
    rect: rects[field],
    value: meta[field],
    fontSize: field === "title" || field === "company" ? 13 : 11,
    onCommit: (value, next) => {
      app.store.edit((doc) => {
        doc.meta[field] = value;
      }, "meta");
      if (next === "forward" || next === "down") {
        const i = TITLE_FIELDS.indexOf(field);
        if (i < TITLE_FIELDS.length - 1) editTitleBlock(app, table, i + 1);
      } else if (next === "back" || next === "up") {
        const i = TITLE_FIELDS.indexOf(field);
        if (i > 0) editTitleBlock(app, table, i - 1);
      }
    },
  });
  return true;
}

/* ---------------- labels, branches, nodes ---------------- */

function editInline(app: AppContext, id: string): boolean {
  const doc = app.store.doc;
  const inline = findInline(doc, id);
  if (!inline) return false;
  const segment = findSegment(doc, inline.seg);
  const ends = segment ? segmentEnds(doc, segment) : null;
  if (!ends) return false;

  const point = lerpPoint(ends[0], ends[1], inline.t);
  const width = Math.max(60, textWidth(inline.text, 11, true) + 24);
  openInlineEditor({
    rect: { x: point.x - width / 2, y: point.y - 9, w: width, h: 18 },
    value: inline.text,
    align: "center",
    onInput: (value) => {
      app.store.live((d) => {
        const it = findInline(d, id);
        if (it) it.text = value;
      }, "live");
    },
    onCommit: (value) => {
      app.store.edit((d) => {
        const it = findInline(d, id);
        if (it) it.text = value;
      }, "inline");
    },
  });
  return true;
}

function editSegment(app: AppContext, id: string): boolean {
  const doc = app.store.doc;
  const segment = findSegment(doc, id);
  const ends = segment ? segmentEnds(doc, segment) : null;
  if (!segment || !ends) return false;

  const middle = lerpPoint(ends[0], ends[1], 0.5);
  openInlineEditor({
    rect: { x: middle.x - 45, y: middle.y - 22, w: 90, h: 16 },
    value: segment.len,
    align: "center",
    fontSize: 12,
    onCommit: (value) => {
      app.store.edit((d) => {
        const s = findSegment(d, id);
        if (s) s.len = value.trim();
      }, "segment");
    },
  });
  return true;
}

function editNode(app: AppContext, id: string): boolean {
  const node = findNode(app.store.doc, id);
  if (!node) return false;

  const width = Math.max(70, textWidth(node.name, 12.5, true) + 30);
  openInlineEditor({
    rect: { x: node.x - width / 2, y: node.y - 34, w: width, h: 18 },
    value: node.name,
    align: "center",
    fontSize: 12.5,
    onCommit: (value) => {
      let updated = 0;
      app.store.edit((d) => {
        const n = findNode(d, id);
        if (n) updated = renameNode(d, n, value);
      }, "rename");
      if (updated > 0) app.toast.show(app.t("toast.renamedRefs", { n: updated }));
    },
  });
  return true;
}
