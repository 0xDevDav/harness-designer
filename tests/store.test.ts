import { beforeEach, describe, expect, it, vi } from "vitest";
import { Store } from "@/core/store";
import { createJunction, findNode, normalizeDoc } from "@/core/doc";
import { DOC_VERSION } from "@/core/types";
import type { HarnessDoc } from "@/core/types";

/** Fixture document: two junctions joined. */
const twoNodes = (): HarnessDoc =>
  normalizeDoc({
    nodes: [
      { id: "n1", x: 0, y: 0 },
      { id: "n2", x: 100, y: 0 },
    ],
    segments: [{ id: "s1", a: "n1", b: "n2" }],
  });

let store: Store;

beforeEach(() => {
  store = new Store();
});

describe("edit", () => {
  it("records nothing when the document does not change", () => {
    expect(store.edit(() => undefined)).toBe(false);
    expect(store.canUndo).toBe(false);

    store.load(twoNodes());
    expect(
      store.edit((d) => {
        findNode(d, "n1")!.x = 0; // riscrive lo stesso valore: nessuna modifica reale
      }),
    ).toBe(false);
    expect(store.canUndo).toBe(false);
  });

  it("records a step when the document changes and tells the listeners", () => {
    const seen: string[] = [];
    const off = store.on("doc", ({ reason }) => seen.push(reason));

    expect(store.edit((d) => void createJunction(d, 10, 20), "crea")).toBe(true);
    expect(store.doc.nodes).toHaveLength(1);
    expect(store.canUndo).toBe(true);
    expect(seen).toEqual(["crea"]);

    off();
    store.edit((d) => void createJunction(d, 30, 40));
    expect(seen).toEqual(["crea"]);
  });

  it("restores the connector invariant after the edit", () => {
    store.load(twoNodes());
    store.edit((d) => {
      const n3 = createJunction(d, 200, 0);
      n3.kind = "connector";
      findNode(d, "n2")!.kind = "connector";
      d.segments.push({ id: "s2", a: "n2", b: n3.id, len: "", refs: "" });
    });
    // the bundle passes through n2, so it goes back to a junction; n3 stays terminal
    expect(findNode(store.doc, "n2")?.kind).toBe("junction");
    expect(store.doc.nodes[2]?.kind).toBe("connector");
  });

  it("calls the autosave on every recorded edit", () => {
    const persist = vi.fn();
    store.setPersister(persist);
    store.edit((d) => void createJunction(d, 0, 0));
    expect(persist).toHaveBeenCalledTimes(1);
    store.edit(() => undefined);
    expect(persist).toHaveBeenCalledTimes(1);
  });
});

describe("undo and redo", () => {
  it("restore the previous and the following state", () => {
    store.load(twoNodes());
    store.edit((d) => void createJunction(d, 500, 500));
    const id = store.doc.nodes[2]?.id;
    expect(store.doc.nodes).toHaveLength(3);

    expect(store.undo()).toBe(true);
    expect(store.doc.nodes).toHaveLength(2);
    expect(store.canRedo).toBe(true);

    expect(store.redo()).toBe(true);
    expect(store.doc.nodes).toHaveLength(3);
    expect(store.doc.nodes[2]?.id).toBe(id);

    expect(store.undo()).toBe(true);
    expect(store.undo()).toBe(false);
    expect(store.canUndo).toBe(false);
  });

  it("a new edit clears the redo stack", () => {
    store.edit((d) => void createJunction(d, 0, 0));
    store.undo();
    expect(store.canRedo).toBe(true);
    store.edit((d) => void createJunction(d, 50, 50));
    expect(store.canRedo).toBe(false);
    expect(store.redo()).toBe(false);
  });

  it("the snapshots are independent of the live document", () => {
    store.load(twoNodes());
    const copia = store.snapshot();
    store.edit((d) => {
      findNode(d, "n1")!.x = 999;
    });
    expect(copia.nodes[0]?.x).toBe(0);
    expect(store.doc.nodes[0]?.x).toBe(999);
  });
});

describe("continuous edits", () => {
  it("beginLive/live/endLive produce a single undo step", () => {
    store.load(twoNodes());

    store.beginLive();
    for (const x of [10, 20, 30, 40]) {
      store.live((d) => {
        findNode(d, "n1")!.x = x;
      });
    }
    expect(store.canUndo).toBe(false); // durante il trascinamento la cronologia non si tocca
    expect(store.endLive("sposta")).toBe(true);
    expect(store.doc.nodes[0]?.x).toBe(40);

    expect(store.undo()).toBe(true);
    expect(store.doc.nodes[0]?.x).toBe(0);
    expect(store.canUndo).toBe(false); // era davvero un passo solo
  });

  it("endLive records nothing when the document is back as it was", () => {
    store.load(twoNodes());
    store.beginLive();
    store.live((d) => {
      findNode(d, "n1")!.x = 50;
    });
    store.live((d) => {
      findNode(d, "n1")!.x = 0;
    });
    expect(store.endLive()).toBe(false);
    expect(store.canUndo).toBe(false);
  });

  it("endLive without beginLive does nothing", () => {
    expect(store.endLive()).toBe(false);
  });

  it("cancelLive puts the document back where it started", () => {
    store.load(twoNodes());
    store.beginLive();
    store.live((d) => {
      findNode(d, "n1")!.x = 777;
    });
    store.cancelLive();
    expect(store.doc.nodes[0]?.x).toBe(0);
    expect(store.canUndo).toBe(false);
  });
});

describe("load", () => {
  it("clears the history and the selection", () => {
    store.edit((d) => void createJunction(d, 0, 0));
    store.undo();
    expect(store.canUndo).toBe(false);
    expect(store.canRedo).toBe(true);

    store.select({ type: "node", id: "qualcosa" });
    store.load(twoNodes());

    expect(store.canUndo).toBe(false);
    expect(store.canRedo).toBe(false);
    expect(store.selection).toBeNull();
    expect(store.doc.nodes).toHaveLength(2);
  });

  it("with resetHistory:false the load stays undoable", () => {
    store.load(twoNodes());
    store.load({}, { resetHistory: false });
    expect(store.doc.nodes).toHaveLength(0);
    expect(store.canUndo).toBe(true);
    store.undo();
    expect(store.doc.nodes).toHaveLength(2);
  });

  it("normalizes whatever it is given", () => {
    store.load({ nodes: [{ id: "a", x: 1, y: 2 }], segments: [{ id: "s", a: "a", b: "fantasma" }] });
    expect(store.doc.segments).toEqual([]);
    expect(store.doc.version).toBe(DOC_VERSION);
  });
});

describe("selection", () => {
  it("is cleared when the element disappears after an undo", () => {
    store.load(twoNodes());
    store.edit((d) => void createJunction(d, 300, 300));
    const nuovo = store.doc.nodes[2];
    expect(nuovo).toBeDefined();

    store.select({ type: "node", id: nuovo!.id });
    expect(store.selection).toEqual({ type: "node", id: nuovo!.id });

    store.undo();
    expect(store.selection).toBeNull();

    // restoring the element does not bring the selection back, but it stays consistent
    store.redo();
    expect(store.selection).toBeNull();
  });

  it("stays put when the element survives the undo", () => {
    store.load(twoNodes());
    store.select({ type: "node", id: "n1" });
    store.edit((d) => void createJunction(d, 300, 300));
    store.undo();
    expect(store.selection).toEqual({ type: "node", id: "n1" });
  });

  it("only notifies when it really changes", () => {
    const seen: Array<string | null> = [];
    store.on("selection", ({ selection }) => seen.push(selection?.id ?? null));
    store.load(twoNodes()); // load emette una selezione nulla

    store.select({ type: "node", id: "n1" });
    store.select({ type: "node", id: "n1" });
    store.select(null);
    store.select({ type: "node", id: "n2" }, { silent: true });

    expect(seen).toEqual([null, "n1", null]);
    expect(store.selection).toEqual({ type: "node", id: "n2" });
  });

  it("gathers several elements, the last one picked staying the primary", () => {
    store.load(twoNodes());
    store.select({ type: "node", id: "n1" });
    store.toggle({ type: "node", id: "n2" });

    expect(store.selection).toEqual({ type: "node", id: "n2" });
    expect(store.selected().map((s) => s.id)).toEqual(["n2", "n1"]);
    expect(store.isSelected({ type: "node", id: "n1" })).toBe(true);
    expect(store.isSelected({ type: "segment", id: "s1" })).toBe(false);
  });

  it("takes an element back out, promoting what is left", () => {
    store.load(twoNodes());
    store.select({ type: "node", id: "n1" });
    store.toggle({ type: "node", id: "n2" });
    store.toggle({ type: "node", id: "n2" });

    expect(store.selection).toEqual({ type: "node", id: "n1" });
    expect(store.also).toHaveLength(0);

    store.toggle({ type: "node", id: "n1" });
    expect(store.selection).toBeNull();
  });

  it("an ordinary click starts again from one", () => {
    store.load(twoNodes());
    store.select({ type: "node", id: "n1" });
    store.toggle({ type: "node", id: "n2" });
    store.select({ type: "node", id: "n1" });

    expect(store.selected().map((s) => s.id)).toEqual(["n1"]);
  });

  it("keeps the rest of the group when one of it disappears", () => {
    store.load(twoNodes());
    store.edit((d) => void createJunction(d, 300, 300));
    const fresh = store.doc.nodes[2]!;

    store.select({ type: "node", id: "n1" });
    store.toggle({ type: "node", id: fresh.id });
    store.undo();

    expect(store.selected().map((s) => s.id)).toEqual(["n1"]);
  });
});

describe("view, tool and grid", () => {
  it("pass the change on to the listeners", () => {
    const views: number[] = [];
    const tools: string[] = [];
    const settings: number[] = [];
    store.on("view", ({ view }) => views.push(view.k));
    store.on("tool", ({ tool }) => tools.push(tool));
    store.on("settings", () => settings.push(1));

    store.setView({ x: 10, y: 20, k: 2 });
    store.setTool("branch");
    store.setTool("branch"); // già attivo: nessun evento
    store.setSnap(false);

    expect(views).toEqual([2]);
    expect(tools).toEqual(["branch"]);
    expect(settings).toHaveLength(1);
    expect(store.view).toEqual({ x: 10, y: 20, k: 2 });
    expect(store.snapEnabled).toBe(false);
  });
});

describe("event robustness", () => {
  it("a faulty listener does not block the others", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const seen: string[] = [];
    store.on("doc", () => {
      throw new Error("guasto");
    });
    store.on("doc", ({ reason }) => seen.push(reason));

    store.edit((d) => void createJunction(d, 0, 0), "crea");

    expect(seen).toEqual(["crea"]);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
