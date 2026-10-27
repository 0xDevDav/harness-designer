import { describe, expect, it } from "vitest";
import type { RendererApi } from "@/app/context";
import { normalizeDoc } from "@/core/doc";
import { freeSpot, overlaps, overlapsAny, separate } from "@/core/overlap";
import type { Rect, Table } from "@/core/types";
import { separateTables } from "@/ui/separate";

const box = (x: number, y: number, w = 100, h = 50): Rect => ({ x, y, w, h });
const at = (r: Rect, p: { x: number; y: number }): Rect => ({ ...r, x: p.x, y: p.y });

describe("overlaps", () => {
  it("is true for rectangles that share area", () => {
    expect(overlaps(box(0, 0), box(50, 20))).toBe(true);
    expect(overlaps(box(0, 0), box(10, 10, 5, 5))).toBe(true);
  });

  it("is false for rectangles that only touch or are apart", () => {
    expect(overlaps(box(0, 0), box(100, 0))).toBe(false);
    expect(overlaps(box(0, 0), box(0, 50))).toBe(false);
    expect(overlaps(box(0, 0), box(300, 300))).toBe(false);
  });

  it("looks at a list", () => {
    expect(overlapsAny(box(0, 0), [box(300, 0), box(50, 10)])).toBe(true);
    expect(overlapsAny(box(0, 0), [box(300, 0)])).toBe(false);
    expect(overlapsAny(box(0, 0), [])).toBe(false);
  });
});

describe("freeSpot", () => {
  it("leaves a rectangle that lies on nothing exactly where it is", () => {
    expect(freeSpot(box(5, 7), [box(300, 300)])).toEqual({ x: 5, y: 7 });
    expect(freeSpot(box(5, 7), [])).toEqual({ x: 5, y: 7 });
  });

  it("moves a drop to the nearest side of what it landed on, leaving the gap", () => {
    // dropped mostly over the right-hand part of the obstacle: nearest way out is to the right
    const spot = freeSpot(box(70, 0), [box(0, 0)], { gap: 12 });
    expect(spot).toEqual({ x: 112, y: 0 });
  });

  it("goes the other way when that is nearer", () => {
    expect(freeSpot(box(-60, 0), [box(0, 0)], { gap: 12 })).toEqual({ x: -112, y: 0 });
    expect(freeSpot(box(0, -30), [box(0, 0)], { gap: 12 })).toEqual({ x: 0, y: -62 });
    expect(freeSpot(box(0, 30), [box(0, 0)], { gap: 12 })).toEqual({ x: 0, y: 62 });
  });

  it("clears every obstacle, not only the first it meets", () => {
    const wall = [box(0, 0), box(112, 0), box(224, 0)];
    const spot = freeSpot(box(50, 0), wall, { gap: 12 });
    const placed = at(box(50, 0), spot);
    for (const o of wall)
      expect(overlaps(placed, { x: o.x - 12, y: o.y - 12, w: o.w + 24, h: o.h + 24 })).toBe(false);
  });

  it("puts the rectangle on the snap grid by its origin, without shrinking the gap", () => {
    // the origin is 4 in from the corner, as a table's is: it is the origin that must be on the grid
    // dropped with its origin at (67, 0), already snapped on the y axis: the corner is at (63, -4)
    const spot = freeSpot(box(63, -4), [box(0, 0)], { gap: 12, grid: 10, anchor: { x: 4, y: 4 } });
    expect((spot.x + 4) % 10).toBe(0);
    expect((spot.y + 4) % 10).toBe(0);
    expect(spot.x).toBeGreaterThanOrEqual(112);
  });

  it("rounds away from the obstacle on the near side too", () => {
    const spot = freeSpot(box(-60, 0, 100, 50), [box(0, 0)], { gap: 12, grid: 10 });
    expect(Math.abs(spot.x % 10)).toBe(0);
    expect(spot.x + 100).toBeLessThanOrEqual(-12);
  });

  it("finds room even when the rectangle is boxed in on every side", () => {
    const around = [box(-110, 0), box(110, 0), box(0, -60), box(0, 60)];
    const spot = freeSpot(box(0, 0), around, { gap: 12 });
    expect(overlapsAny(at(box(0, 0), spot), around)).toBe(false);
  });
});

describe("separate", () => {
  const ids = (m: Map<string, unknown>): string[] => [...m.keys()].sort();

  it("moves nothing when nothing overlaps", () => {
    const items = [
      { id: "a", rect: box(0, 0) },
      { id: "b", rect: box(200, 0) },
    ];
    expect(separate(items, new Set(["a", "b"])).size).toBe(0);
  });

  it("moves only the objects that may move", () => {
    const items = [
      { id: "node", rect: box(0, 0) },
      { id: "table", rect: box(40, 10) },
    ];
    expect(ids(separate(items, new Set(["table"])))).toEqual(["table"]);
    expect(ids(separate(items, new Set(["node"])))).toEqual(["node"]);
  });

  it("leaves the first of two movable objects where it is, in reading order", () => {
    const items = [
      { id: "later", rect: box(40, 30) },
      { id: "first", rect: box(0, 0) },
    ];
    const moved = separate(items, new Set(["first", "later"]));
    expect(ids(moved)).toEqual(["later"]);
  });

  it("does not leave a moved object on top of another moved one", () => {
    const items = [
      { id: "a", rect: box(0, 0) },
      { id: "b", rect: box(20, 0) },
      { id: "c", rect: box(40, 0) },
    ];
    const moved = separate(items, new Set(["a", "b", "c"]));
    const final = items.map((i) => at(i.rect, moved.get(i.id) ?? i.rect));
    for (let i = 0; i < final.length; i++) {
      for (let j = i + 1; j < final.length; j++)
        expect(overlaps(final[i] as Rect, final[j] as Rect)).toBe(false);
    }
  });

  it("gives the same answer however the objects are listed", () => {
    const a = { id: "a", rect: box(0, 0) };
    const b = { id: "b", rect: box(30, 10) };
    const movable = new Set(["a", "b"]);
    expect([...separate([a, b], movable)]).toEqual([...separate([b, a], movable)]);
  });
});

describe("separateTables", () => {
  // a renderer that sizes a table by its columns: 60 wide each, 17 tall a row and a header
  const renderer = (doc: { tables: Table[] }): RendererApi =>
    ({
      entityBBox: (sel: { type: string; id: string }) => {
        const t = doc.tables.find((x) => x.id === sel.id);
        return t
          ? { x: t.x - 4, y: t.y - 4, w: (t.head?.length ?? 1) * 60 + 8, h: (t.rows.length + 2) * 17 + 8 }
          : null;
      },
    }) as unknown as RendererApi;
  const table = (id: string, x: number, y: number, columns: number): Table => ({
    id,
    x,
    y,
    kind: "table",
    head: Array.from({ length: columns }, (_, i) => `c${i}`),
    rows: [["1"]],
  });

  it("moves a table that grew onto its neighbour, and only that one", () => {
    const doc = normalizeDoc({ tables: [table("a", 0, 0, 3), table("b", 200, 0, 3)] });
    const [a, b] = doc.tables as [Table, Table];
    a.head = [...(a.head ?? []), "c3"]; // a is now 240 wide and lies on b
    const moved = separateTables(doc, renderer(doc), true, ["a"]);
    expect(moved).toBe(1);
    expect(b).toMatchObject({ x: 200, y: 0 });
    const ra = renderer(doc).entityBBox({ type: "table", id: "a" }) as Rect;
    const rb = renderer(doc).entityBBox({ type: "table", id: "b" }) as Rect;
    expect(overlaps(ra, rb)).toBe(false);
    // and on the grid
    expect(Math.abs(a.x % 10)).toBe(0);
    expect(Math.abs(a.y % 10)).toBe(0);
  });

  it("moves nothing when the table that changed lies on nothing", () => {
    const doc = normalizeDoc({ tables: [table("a", 0, 0, 3), table("b", 400, 0, 3)] });
    expect(separateTables(doc, renderer(doc), true, ["a"])).toBe(0);
  });
});
