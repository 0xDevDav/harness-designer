import type { Point, Rect } from "./types";

/**
 * Keeping things on the sheet from lying on top of each other.
 *
 * Pure geometry on rectangles: the sheet and the schematic each know their own
 * objects and how big they are, and ask here where one of them can go. Nothing
 * here knows what a table or a connector is.
 */

/** Clear space left between an object and what it was moved away from. */
export const OVERLAP_GAP = 12;

export interface SpotOptions {
  /** clear space to leave round everything the rectangle has to avoid */
  gap?: number;
  /**
   * Snap grid, or none. The rectangle is placed so that its anchor falls on the
   * grid: an object snaps by its own origin, which is not always its corner.
   */
  grid?: number | null;
  /** where the object's origin is from the rectangle's corner, when they differ */
  anchor?: Point;
}

/** True when the two rectangles share any area. Touching edges do not count. */
export const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const grown = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, w: r.w + by * 2, h: r.h + by * 2 });

/** True when the rectangle lies on any of the others. */
export const overlapsAny = (rect: Rect, others: readonly Rect[]): boolean =>
  others.some((o) => overlaps(rect, o));

/**
 * Where the rectangle can go so that it lies on nothing, as near as possible to
 * where it is. A rectangle that already lies on nothing stays where it is.
 *
 * Every place worth considering has an edge of the rectangle against an edge of
 * something else (with the gap between them), or is where it started on that
 * axis, so those are all that are tried; the nearest one that is clear wins.
 * Moving it as little as possible is the point: it is the drop the person made,
 * nudged just far enough.
 */
export function freeSpot(rect: Rect, obstacles: readonly Rect[], options: SpotOptions = {}): Point {
  const gap = options.gap ?? OVERLAP_GAP;
  const grid = options.grid ?? null;
  const anchor = options.anchor ?? { x: 0, y: 0 };
  if (!overlapsAny(rect, obstacles)) return { x: rect.x, y: rect.y };

  // away from the obstacle the rounding goes outwards, or the gap would shrink
  const down = (v: number, off: number): number => (grid ? Math.floor((v + off) / grid) * grid - off : v);
  const up = (v: number, off: number): number => (grid ? Math.ceil((v + off) / grid) * grid - off : v);

  const xs = new Set<number>([rect.x]);
  const ys = new Set<number>([rect.y]);
  for (const o of obstacles) {
    xs.add(down(o.x - gap - rect.w, anchor.x));
    xs.add(up(o.x + o.w + gap, anchor.x));
    ys.add(down(o.y - gap - rect.h, anchor.y));
    ys.add(up(o.y + o.h + gap, anchor.y));
  }

  const clear = (x: number, y: number): boolean => {
    const at = { x, y, w: rect.w, h: rect.h };
    return !obstacles.some((o) => overlaps(at, grown(o, gap)));
  };

  let best: Point | null = null;
  let bestCost = Infinity;
  for (const x of xs) {
    for (const y of ys) {
      const cost = (x - rect.x) ** 2 + (y - rect.y) ** 2;
      if (cost >= bestCost || !clear(x, y)) continue;
      best = { x, y };
      bestCost = cost;
    }
  }
  // there is always room beyond the last obstacle, which the candidates include
  return best ?? { x: rect.x, y: rect.y };
}

export interface Item {
  id: string;
  rect: Rect;
  options?: SpotOptions;
}

/**
 * Clears up a whole drawing: the places the objects that may be moved have to go
 * to so that nothing lies on anything.
 *
 * What may not be moved is where it is, and what may be moved stays put unless
 * it lies on something already settled. They are taken in reading order, top to
 * bottom and left to right, so the result does not depend on the order the
 * drawing happens to list them in. Returns only the objects that moved.
 */
export function separate(
  items: readonly Item[],
  movable: ReadonlySet<string>,
  options: SpotOptions = {},
): Map<string, Point> {
  const moved = new Map<string, Point>();
  const settled: Rect[] = items.filter((i) => !movable.has(i.id)).map((i) => i.rect);
  const order = items
    .filter((i) => movable.has(i.id))
    .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x || a.id.localeCompare(b.id));
  for (const item of order) {
    const opts = { ...options, ...item.options };
    const spot = freeSpot(item.rect, settled, opts);
    if (spot.x !== item.rect.x || spot.y !== item.rect.y) moved.set(item.id, spot);
    settled.push({ ...item.rect, x: spot.x, y: spot.y });
  }
  return moved;
}
