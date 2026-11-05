import type { AppContext } from "@/app/context";
import { snapTo } from "@/core/geometry";
import type { HarnessDoc, Point, Table } from "@/core/types";
import { tableSize } from "@/render/tables";
import { settleNewTable } from "./separate";

/** Centre of the drawing area in document coordinates: new items are born there. */
export function viewCenter(app: AppContext): Point {
  const canvas = document.querySelector(".canvas");
  const box = canvas?.getBoundingClientRect();
  const cx = box && box.width > 0 ? box.left + box.width / 2 : window.innerWidth / 2;
  const cy = box && box.height > 0 ? box.top + box.height / 2 : window.innerHeight / 2;
  return app.renderer.screenToWorld({ clientX: cx, clientY: cy });
}

/**
 * Adds a table to the sheet, at the nearest place where it lies on nothing.
 * Inside a store edit. Returns true when that place was farther than a nudge
 * from where the table was put, for the caller to say so with `tellPlacedFar`
 * once the edit is done.
 */
export function placeTable(
  app: Pick<AppContext, "renderer" | "store">,
  doc: HarnessDoc,
  table: Table,
): boolean {
  doc.tables.push(table);
  return settleNewTable(doc, app.renderer, app.store.snapEnabled, table.id) === "far";
}

/**
 * Says that a new table went some way off to find room, and with `reveal`
 * brings it into view: put where the view was, it would otherwise seem not to
 * have appeared at all.
 */
export function tellPlacedFar(app: AppContext, tableId: string, reveal = true): void {
  app.toast.show(app.t("toast.placedFar"));
  if (!reveal) return;
  requestAnimationFrame(() => {
    const box = app.renderer.entityBBox({ type: "table", id: tableId });
    if (box) app.renderer.centerOn(box);
  });
}

/** Inserts a table centred on the view, or at the nearest free place, and selects it. */
export function insertTable(app: AppContext, table: Table): void {
  const center = viewCenter(app);
  const size = tableSize(table, app.doc.meta, app.t);
  table.x = snapTo(center.x - size.w / 2, app.store.snapEnabled);
  table.y = snapTo(center.y - size.h / 2, app.store.snapEnabled);
  let far = false;
  app.store.edit((doc) => {
    far = placeTable(app, doc, table);
  }, "insert");
  app.store.select({ type: "table", id: table.id });
  if (far) tellPlacedFar(app, table.id);
}
