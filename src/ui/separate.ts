/**
 * Where the sheet and the schematic use the overlap rules.
 *
 * `core/overlap.ts` knows rectangles. This knows which things on each view are
 * objects, how big they are, and what moving one of them means in the document:
 * a table has an origin, a connector is a node on the bundle, and a box in the
 * schematic is a place remembered by name.
 *
 * The sheet's objects are the tables and the connectors. A junction is a point
 * where the branches meet, and a branch is a line: neither is something that
 * can lie on top of something else in the way a table lying on a connector is.
 */
import type { AppContext, RendererApi } from "@/app/context";
import { findNode, findTable } from "@/core/doc";
import { GRID } from "@/core/geometry";
import { freeSpot, overlaps, separate } from "@/core/overlap";
import type { Item } from "@/core/overlap";
import { buildSchematic } from "@/core/schematic";
import type { HarnessDoc, Point, Rect } from "@/core/types";

/** Clear space left round a box in the schematic: the wires run in it. */
const BOX_GAP = 24;

const gridFor = (snap: boolean): number | null => (snap ? GRID : null);

/** What kind of object a drop on the sheet was. */
export type SheetObject = "node" | "table";

interface SheetItem extends Item {
  kind: SheetObject;
  /** id in the document */
  ref: string;
  /** where the object's origin is from the corner of its rectangle */
  anchor: Point;
}

const keyOf = (kind: SheetObject, ref: string): string => `${kind}:${ref}`;

/** Every connector and every table on the sheet, with the room it takes. */
function sheetItems(doc: HarnessDoc, renderer: RendererApi, snap: boolean): SheetItem[] {
  const items: SheetItem[] = [];
  const add = (kind: SheetObject, ref: string, origin: Point, rect: Rect | null): void => {
    if (!rect) return;
    const anchor = { x: origin.x - rect.x, y: origin.y - rect.y };
    items.push({
      id: keyOf(kind, ref),
      kind,
      ref,
      rect,
      anchor,
      options: { grid: gridFor(snap), anchor },
    });
  };
  for (const node of doc.nodes) {
    if (node.kind === "connector")
      add("node", node.id, node, renderer.entityBBox({ type: "node", id: node.id }));
  }
  for (const table of doc.tables) {
    add("table", table.id, table, renderer.entityBBox({ type: "table", id: table.id }));
  }
  return items;
}

/** Puts an object of the sheet where its rectangle's corner has been moved to. */
function moveSheetObject(doc: HarnessDoc, item: SheetItem, corner: Point): void {
  const target = item.kind === "node" ? findNode(doc, item.ref) : findTable(doc, item.ref);
  if (!target) return;
  target.x = corner.x + item.anchor.x;
  target.y = corner.y + item.anchor.y;
}

/**
 * Called when a drop on the sheet is about to be committed: if what was dropped
 * lies on a table or a connector, it is moved to the nearest place that does
 * not, inside the same edit, so the drop and the nudge are one undo step.
 * Returns true when it was moved.
 */
export function settleSheetDrop(
  app: Pick<AppContext, "store" | "renderer">,
  kind: SheetObject,
  ref: string,
): boolean {
  const { store, renderer } = app;
  if (kind === "node" && findNode(store.doc, ref)?.kind !== "connector") return false;
  const items = sheetItems(store.doc, renderer, store.snapEnabled);
  const key = keyOf(kind, ref);
  const dropped = items.find((i) => i.id === key);
  if (!dropped) return false;
  const others = items.filter((i) => i.id !== key).map((i) => i.rect);
  const spot = freeSpot(dropped.rect, others, dropped.options);
  if (spot.x === dropped.rect.x && spot.y === dropped.rect.y) return false;
  store.live((doc) => moveSheetObject(doc, dropped, spot), "move");
  return true;
}

/**
 * Moves apart whatever on the sheet lies on something else. Tables give way to
 * connectors, which sit on the bundle, and a connector only moves for another
 * connector. Returns how many objects moved.
 */
function separateSheet(doc: HarnessDoc, renderer: RendererApi, snap: boolean): number {
  const items = sheetItems(doc, renderer, snap);
  const movable = new Set<string>();
  const connectors = items
    .filter((i) => i.kind === "node")
    .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
  connectors.forEach((c, n) => {
    if (connectors.slice(0, n).some((earlier) => overlaps(c.rect, earlier.rect))) movable.add(c.id);
  });
  for (const item of items) if (item.kind === "table") movable.add(item.id);

  const moved = separate(items, movable);
  for (const [id, spot] of moved) {
    const item = items.find((i) => i.id === id);
    if (item) moveSheetObject(doc, item, spot);
  }
  return moved.size;
}

/**
 * Called when a box dropped in the schematic is about to be committed: if it
 * lies on another box it goes to the nearest place that does not.
 */
export function settleSchematicDrop(app: Pick<AppContext, "store">, name: string): boolean {
  const { store } = app;
  const model = buildSchematic(store.doc);
  const box = model.byName.get(name);
  if (!box) return false;
  const others = model.boxes.filter((b) => b.id !== name).map(boxRect);
  const rect = boxRect(box);
  const spot = freeSpot(rect, others, { gap: BOX_GAP, grid: gridFor(store.snapEnabled) });
  if (spot.x === rect.x && spot.y === rect.y) return false;
  store.live((doc) => {
    const placed: Record<string, Point> = doc.schematic ?? (doc.schematic = {});
    placed[name] = { x: spot.x, y: spot.y };
  }, "schematic");
  return true;
}

const boxRect = (b: { x: number; y: number; w: number; h: number }): Rect => ({
  x: b.x,
  y: b.y,
  w: b.w,
  h: b.h,
});

/**
 * Moves apart the boxes of the schematic that lie on each other. Only a box
 * somebody put where it is can move: the others are laid out so that they do
 * not touch, and move on their own when the drawing changes.
 */
function separateSchematic(doc: HarnessDoc, snap: boolean): number {
  const model = buildSchematic(doc);
  const items: Item[] = model.boxes.map((b) => ({ id: b.id, rect: boxRect(b) }));
  const movable = new Set(model.boxes.filter((b) => b.placed).map((b) => b.id));
  const moved = separate(items, movable, { gap: BOX_GAP, grid: gridFor(snap) });
  if (!moved.size) return 0;
  const placed: Record<string, Point> = doc.schematic ?? (doc.schematic = {});
  for (const [name, spot] of moved) placed[name] = { x: spot.x, y: spot.y };
  return moved.size;
}

/** The command: clears up both views. Returns how many objects moved. */
export function separateOverlaps(app: AppContext): number {
  let moved = 0;
  app.store.edit((doc) => {
    moved =
      separateSheet(doc, app.renderer, app.store.snapEnabled) + separateSchematic(doc, app.store.snapEnabled);
  }, "separate");
  return moved;
}
