import { afterEach, describe, expect, it } from "vitest";
import { Store } from "@/core/store";
import { findNode, findTable, normalizeDoc } from "@/core/doc";
import type { AppContext, RendererApi } from "@/app/context";
import type { Rect } from "@/core/types";
import { MAX_NUDGE, separateOverlaps, settleSheetDrop } from "@/ui/separate";
import { setViewMode } from "@/ui/viewmode";

/** A renderer that knows only the rectangles it is given, by id. */
const rendererOf = (rects: Record<string, Rect>): RendererApi =>
  ({ entityBBox: (e: { id: string }) => rects[e.id] ?? null }) as unknown as RendererApi;

const storeWith = (tableX = 0): Store => {
  const store = new Store();
  store.load(
    normalizeDoc({
      nodes: [{ id: "c", kind: "connector", x: 100, y: 20, name: "C1" }],
      tables: [{ id: "t", x: tableX, y: 0, title: "Notes", rows: [["a"]] }],
    }),
  );
  return store;
};

afterEach(() => setViewMode("board"));

describe("settleSheetDrop", () => {
  it("moves a drop on a table to the nearest free place", () => {
    const store = storeWith();
    const renderer = rendererOf({ t: { x: 0, y: 0, w: 150, h: 100 }, c: { x: 100, y: 20, w: 40, h: 40 } });
    expect(settleSheetDrop({ store, renderer }, "node", "c")).toBe("moved");
    expect(findNode(store.doc, "c")!.x).toBeGreaterThan(150);
  });

  it("leaves a drop where it is when the nearest free place is farther than a nudge", () => {
    const store = storeWith();
    const long = { x: 0, y: 0, w: MAX_NUDGE * 4, h: 600 };
    const renderer = rendererOf({ t: long, c: { x: MAX_NUDGE * 2, y: 300, w: 40, h: 40 } });
    store.load(
      normalizeDoc({
        nodes: [{ id: "c", kind: "connector", x: MAX_NUDGE * 2, y: 300, name: "C1" }],
        tables: [{ id: "t", x: 0, y: 0, title: "Wires", rows: [["a"]] }],
      }),
    );
    expect(settleSheetDrop({ store, renderer }, "node", "c")).toBe("far");
    expect(findNode(store.doc, "c")!.x).toBe(MAX_NUDGE * 2);
  });

  it("does nothing for a drop that lies on nothing", () => {
    const store = storeWith();
    const renderer = rendererOf({ t: { x: 0, y: 0, w: 50, h: 50 }, c: { x: 300, y: 300, w: 40, h: 40 } });
    expect(settleSheetDrop({ store, renderer }, "node", "c")).toBe("clear");
  });
});

describe("separateOverlaps", () => {
  const overlapping = (): { app: AppContext; store: Store } => {
    const store = new Store();
    store.load(
      normalizeDoc({
        tables: [
          { id: "a", x: 0, y: 0, title: "A", rows: [["a"]] },
          { id: "b", x: 10, y: 10, title: "B", rows: [["b"]] },
        ],
      }),
    );
    const renderer = rendererOf({ a: { x: 0, y: 0, w: 100, h: 50 }, b: { x: 10, y: 10, w: 100, h: 50 } });
    return { store, app: { store, renderer } as unknown as AppContext };
  };

  it("clears up the sheet when the sheet is on screen", () => {
    const { app, store } = overlapping();
    setViewMode("board");
    expect(separateOverlaps(app)).toBe(1);
    expect(findTable(store.doc, "b")!.x !== 10 || findTable(store.doc, "b")!.y !== 10).toBe(true);
  });

  it("leaves the sheet alone while only the schematic is shown", () => {
    const { app, store } = overlapping();
    setViewMode("schematic");
    expect(separateOverlaps(app)).toBe(0);
    expect(findTable(store.doc, "b")).toMatchObject({ x: 10, y: 10 });
  });
});
