import type { AppContext } from "@/app/context";
import { snapTo } from "@/core/geometry";
import type { Point, Table } from "@/core/types";
import { tableSize } from "@/render/tables";

/** Centre of the drawing area in document coordinates: new items are born there. */
export function viewCenter(app: AppContext): Point {
  const canvas = document.querySelector(".canvas");
  const box = canvas?.getBoundingClientRect();
  const cx = box && box.width > 0 ? box.left + box.width / 2 : window.innerWidth / 2;
  const cy = box && box.height > 0 ? box.top + box.height / 2 : window.innerHeight / 2;
  return app.renderer.screenToWorld({ clientX: cx, clientY: cy });
}

/** Inserts a table centred on the view and selects it. */
export function insertTable(app: AppContext, table: Table): void {
  const center = viewCenter(app);
  const size = tableSize(table, app.doc.meta, app.t);
  table.x = snapTo(center.x - size.w / 2, app.store.snapEnabled);
  table.y = snapTo(center.y - size.h / 2, app.store.snapEnabled);
  app.store.edit((doc) => {
    doc.tables.push(table);
  }, "insert");
  app.store.select({ type: "table", id: table.id });
}
