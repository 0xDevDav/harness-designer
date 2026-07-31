import { cloneDoc, emptyDoc, normalizeConnectors, normalizeDoc } from "./doc";
import type { HarnessDoc, Selection, Viewport } from "./types";

export type ToolName = "select" | "branch";

export interface StoreEvents {
  /** the document changed and the drawing needs a redraw */
  doc: { reason: string };
  /** the selection changed */
  selection: { selection: Selection | null };
  view: { view: Viewport };
  tool: { tool: ToolName };
  /** settings that are not part of the document (snap, language…) */
  settings: Record<string, never>;
  /** the document was replaced (file opened, new, sample) */
  load: { doc: HarnessDoc };
}

type Listener<K extends keyof StoreEvents> = (payload: StoreEvents[K]) => void;

const HISTORY_LIMIT = 120;
/** Memory ceiling for the history: past it, the oldest states are dropped. */
const HISTORY_BYTES = 24 * 1024 * 1024;

/**
 * Application state. Every change to the document goes through here, so that
 * history, autosave and redraw always stay in step.
 */
export class Store {
  doc: HarnessDoc = emptyDoc();
  selection: Selection | null = null;
  view: Viewport = { x: 0, y: 0, k: 1 };
  tool: ToolName = "select";
  snapEnabled = true;

  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private undoBytes = 0;
  private liveSnapshot: string | null = null;
  private listeners = new Map<keyof StoreEvents, Set<Listener<never>>>();
  private persist: ((doc: HarnessDoc) => void) | null = null;

  /** Wires up the autosave function, injected by the I/O layer. */
  setPersister(fn: (doc: HarnessDoc) => void): void {
    this.persist = fn;
  }

  /* ---------------- events ---------------- */

  on<K extends keyof StoreEvents>(event: K, fn: Listener<K>): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }

  emit<K extends keyof StoreEvents>(event: K, payload: StoreEvents[K]): void {
    for (const fn of this.listeners.get(event) ?? []) {
      try {
        (fn as Listener<K>)(payload);
      } catch (err) {
        console.error(`[harness] a "${String(event)}" listener threw`, err);
      }
    }
  }

  /* ---------------- edits ---------------- */

  /**
   * Changes the document as one undoable action. If the callback changes
   * nothing, no state is recorded, so undo never takes an empty step.
   */
  edit(mutate: (doc: HarnessDoc) => void, reason = "edit"): boolean {
    const before = JSON.stringify(this.doc);
    mutate(this.doc);
    normalizeConnectors(this.doc);
    const after = JSON.stringify(this.doc);
    if (before === after) return false;
    this.pushHistory(before);
    this.afterChange(reason);
    return true;
  }

  /** Start of a continuous edit: a drag, or typing into a field. */
  beginLive(): void {
    if (this.liveSnapshot === null) this.liveSnapshot = JSON.stringify(this.doc);
  }

  /** Update during a continuous edit: redraws without touching the history. */
  live(mutate: (doc: HarnessDoc) => void, reason = "live"): void {
    mutate(this.doc);
    this.emit("doc", { reason });
  }

  /** End of a continuous edit: records a single undo step. */
  endLive(reason = "edit"): boolean {
    const before = this.liveSnapshot;
    this.liveSnapshot = null;
    if (before === null) return false;
    normalizeConnectors(this.doc);
    if (before === JSON.stringify(this.doc)) return false;
    this.pushHistory(before);
    this.afterChange(reason);
    return true;
  }

  cancelLive(): void {
    if (this.liveSnapshot === null) return;
    this.doc = JSON.parse(this.liveSnapshot) as HarnessDoc;
    this.liveSnapshot = null;
    this.afterChange("cancel");
  }

  private pushHistory(snapshot: string): void {
    this.undoStack.push(snapshot);
    this.undoBytes += snapshot.length;
    while (this.undoStack.length > HISTORY_LIMIT || this.undoBytes > HISTORY_BYTES) {
      const dropped = this.undoStack.shift();
      if (dropped === undefined) break;
      this.undoBytes -= dropped.length;
    }
    this.redoStack = [];
  }

  private afterChange(reason: string): void {
    this.persist?.(this.doc);
    this.emit("doc", { reason });
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): boolean {
    const snapshot = this.undoStack.pop();
    if (snapshot === undefined) return false;
    this.undoBytes -= snapshot.length;
    this.redoStack.push(JSON.stringify(this.doc));
    this.doc = JSON.parse(snapshot) as HarnessDoc;
    this.dropDanglingSelection();
    this.afterChange("undo");
    return true;
  }

  redo(): boolean {
    const snapshot = this.redoStack.pop();
    if (snapshot === undefined) return false;
    this.pushHistoryWithoutClearingRedo(JSON.stringify(this.doc));
    this.doc = JSON.parse(snapshot) as HarnessDoc;
    this.dropDanglingSelection();
    this.afterChange("redo");
    return true;
  }

  private pushHistoryWithoutClearingRedo(snapshot: string): void {
    this.undoStack.push(snapshot);
    this.undoBytes += snapshot.length;
  }

  /** After undo or redo the selection may point at an element that is gone. */
  private dropDanglingSelection(): void {
    const sel = this.selection;
    if (!sel) return;
    const pools = {
      node: this.doc.nodes,
      segment: this.doc.segments,
      inline: this.doc.inlines,
      table: this.doc.tables,
    } as const;
    const exists = pools[sel.type].some((e: { id: string }) => e.id === sel.id);
    if (!exists) this.select(null, { silent: true });
  }

  /* ---------------- document ---------------- */

  /** Replaces the document: file opened, new, or sample. */
  load(input: unknown, options: { resetHistory?: boolean; reason?: string } = {}): void {
    const next = normalizeDoc(input);
    if (options.resetHistory !== false) {
      this.undoStack = [];
      this.redoStack = [];
      this.undoBytes = 0;
    } else {
      this.pushHistory(JSON.stringify(this.doc));
    }
    this.doc = next;
    this.selection = null;
    this.liveSnapshot = null;
    this.persist?.(this.doc);
    this.emit("load", { doc: next });
    this.emit("selection", { selection: null });
    this.emit("doc", { reason: options.reason ?? "load" });
  }

  snapshot(): HarnessDoc {
    return cloneDoc(this.doc);
  }

  /* ---------------- selection, view, tool ---------------- */

  select(selection: Selection | null, options: { silent?: boolean } = {}): void {
    const same =
      (selection === null && this.selection === null) ||
      (selection !== null &&
        this.selection !== null &&
        selection.type === this.selection.type &&
        selection.id === this.selection.id);
    this.selection = selection;
    if (same || options.silent) return;
    this.emit("selection", { selection });
    this.emit("doc", { reason: "selection" });
  }

  setView(view: Viewport): void {
    this.view = view;
    this.emit("view", { view });
    this.emit("doc", { reason: "view" });
  }

  setTool(tool: ToolName): void {
    if (this.tool === tool) return;
    this.tool = tool;
    this.emit("tool", { tool });
    this.emit("doc", { reason: "tool" });
  }

  setSnap(enabled: boolean): void {
    this.snapEnabled = enabled;
    this.emit("settings", {});
  }
}
