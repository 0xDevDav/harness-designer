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
 * Adds a table to the sheet, moved off whatever it would lie on as a drop is.
 * Inside a store edit. Returns true when no free place was near enough and it
 * was left on top of something, for the caller to say so once the edit is done.
 */
export function placeTable(
  app: Pick<AppContext, "renderer" | "store">,
  doc: HarnessDoc,
  table: Table,
): boolean {
  doc.tables.push(table);
  return settleNewTable(doc, app.renderer, app.store.snapEnabled, table.id) === "far";
}

/** Inserts a table centred on the view, or at the nearest free place, and selects it. */
export function insertTable(app: AppContext, table: Table): void {
  const center = viewCenter(app);
  const size = tableSize(table, app.doc.meta, app.t);
  table.x = snapTo(center.x - size.w / 2, app.store.snapEnabled);
  table.y = snapTo(center.y - size.h / 2, app.store.snapEnabled);
  let onTop = false;
  app.store.edit((doc) => {
    onTop = placeTable(app, doc, table);
  }, "insert");
  app.store.select({ type: "table", id: table.id });
  if (onTop) app.toast.show(app.t("toast.dropFar"));
}
