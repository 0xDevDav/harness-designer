/**
 * Copying a piece of the drawing and putting it down again somewhere else.
 *
 * A clipping is a part of a document cut loose from it: the elements
 * themselves, copied, with the references between them left exactly as they
 * were. What decides whether the copy makes sense is which of those references
 * land inside the clipping and which point back out of it.
 *
 * Inside, they are rewired to the copies. Two connectors copied together stay
 * plugged into each other, a branch keeps the two ends it was drawn between,
 * and a cavity table copied along with its connector goes on belonging to it —
 * to the copy of it.
 *
 * Outside, they are dropped, because a copy may not lay claim to anything the
 * original already owns. A connector copied on its own is not mated to
 * anything: its partner is taken, and a joint is between two ends. A cavity
 * table copied on its own belongs to no connector, or the drawing would hold
 * two tables describing one plug and every wire in it would be counted twice.
 *
 * A name is a reference like any other — the pin-outs say `C3` and mean
 * whatever node is called that — so a copied connector is given a free name
 * rather than the one it was copied from. Two nodes with one name is exactly
 * the fault that makes half a harness look unreachable.
 */

import { nodeForTable } from "./doc";
import { snapTo } from "./geometry";
import { uid } from "./ids";
import type { HNode, HarnessDoc, Inline, Point, Segment, Selection, Table } from "./types";

/** A piece of a drawing, on its own. */
export interface Clipping {
  nodes: HNode[];
  segments: Segment[];
  inlines: Inline[];
  tables: Table[];
}

export const isEmptyClipping = (clip: Clipping): boolean =>
  !clip.nodes.length && !clip.segments.length && !clip.inlines.length && !clip.tables.length;

export const countOf = (clip: Clipping): number =>
  clip.nodes.length + clip.segments.length + clip.inlines.length + clip.tables.length;

/**
 * What a selection stands for, copied out of the document.
 *
 * A branch brings its two ends with it, because a branch without them is a line
 * between nothing and nothing. The title block does not come at all: there is
 * one to a sheet, and a second would not be a copy of the cartouche but a
 * contradiction of it.
 */
export function copySelection(doc: HarnessDoc, selection: readonly Selection[]): Clipping {
  const clip: Clipping = { nodes: [], segments: [], inlines: [], tables: [] };
  const seen = new Set<string>();
  const once = (id: string): boolean => (seen.has(id) ? false : (seen.add(id), true));

  const takeNode = (id: string): void => {
    const node = doc.nodes.find((n) => n.id === id);
    if (node && once(node.id)) clip.nodes.push(structuredCopy(node));
  };

  for (const sel of selection) {
    if (sel.type === "node") takeNode(sel.id);
    else if (sel.type === "segment") {
      const seg = doc.segments.find((s) => s.id === sel.id);
      if (!seg || !once(seg.id)) continue;
      clip.segments.push(structuredCopy(seg));
      takeNode(seg.a);
      takeNode(seg.b);
    } else if (sel.type === "inline") {
      const inline = doc.inlines.find((i) => i.id === sel.id);
      if (inline && once(inline.id)) clip.inlines.push(structuredCopy(inline));
    } else if (sel.type === "table") {
      const table = doc.tables.find((t) => t.id === sel.id);
      if (table && table.kind !== "title" && once(table.id)) clip.tables.push(structuredCopy(table));
    }
  }
  return clip;
}

/**
 * Puts a clipping into the document with its top-left corner at `at`, and says
 * what was made so the caller can select it.
 *
 * The whole clipping moves as one piece: what was copied keeps its shape and
 * its spacing, and only the corner it is measured from is the pointer's. A
 * label has no place of its own — it lives at a point along a branch — so it
 * neither takes part in that measurement nor moves; it goes onto whichever
 * branch it was told, which is the copied one when that came too.
 */
export function pasteClipping(doc: HarnessDoc, clip: Clipping, at: Point, snap: boolean): Selection[] {
  let x0 = Infinity;
  let y0 = Infinity;
  for (const placed of [...clip.nodes, ...clip.tables]) {
    x0 = Math.min(x0, placed.x);
    y0 = Math.min(y0, placed.y);
  }
  const dx = Number.isFinite(x0) ? snapTo(at.x - x0, snap) : 0;
  const dy = Number.isFinite(y0) ? snapTo(at.y - y0, snap) : 0;

  const idOf = new Map<string, string>();
  const nameOf = new Map<string, string>();
  const made: Selection[] = [];

  // Names already spoken for, tables included: a table titled `C9` is read as
  // C9's pin-outs whether or not a connector of that name has been drawn yet,
  // so handing `C9` to a copy would quietly join the two.
  const taken = new Set<string>();
  for (const n of doc.nodes) if (n.name.trim()) taken.add(n.name.trim());
  for (const t of doc.tables) if (t.title?.trim()) taken.add(t.title.trim());
  const freeName = (like: string): string => {
    const prefix = /^[A-Za-z]+/.exec(like.trim())?.[0] ?? "C";
    let i = 1;
    while (taken.has(prefix + i)) i++;
    taken.add(prefix + i);
    return prefix + i;
  };

  for (const node of clip.nodes) {
    const copy: HNode = { ...node, id: uid("n"), x: node.x + dx, y: node.y + dy };
    delete copy.mate;
    if (node.name.trim()) {
      copy.name = freeName(node.name);
      nameOf.set(node.id, copy.name);
    }
    idOf.set(node.id, copy.id);
    doc.nodes.push(copy);
    made.push({ type: "node", id: copy.id });
  }
  // a pair copied together is still a pair, of the two copies
  for (const node of clip.nodes) {
    const self = idOf.get(node.id);
    const mate = node.mate ? idOf.get(node.mate) : undefined;
    if (!self || !mate) continue;
    const copy = doc.nodes.find((n) => n.id === self);
    if (copy) copy.mate = mate;
  }

  for (const seg of clip.segments) {
    const a = idOf.get(seg.a);
    const b = idOf.get(seg.b);
    if (!a || !b) continue;
    const copy: Segment = { ...seg, id: uid("s"), a, b };
    if (seg.points?.length) copy.points = seg.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    idOf.set(seg.id, copy.id);
    doc.segments.push(copy);
    made.push({ type: "segment", id: copy.id });
  }

  for (const inline of clip.inlines) {
    // the copied branch when it came along, otherwise whatever branch the label
    // was told to go on — the caller finds one for a label pasted by itself
    const seg = idOf.get(inline.seg) ?? (doc.segments.some((s) => s.id === inline.seg) ? inline.seg : "");
    if (!seg) continue;
    const copy: Inline = { ...inline, id: uid("i"), seg };
    doc.inlines.push(copy);
    made.push({ type: "inline", id: copy.id });
  }

  for (const table of clip.tables) {
    const copy: Table = {
      ...table,
      id: uid("t"),
      x: table.x + dx,
      y: table.y + dy,
      rows: table.rows.map((row) => [...row]),
    };
    if (table.head) copy.head = [...table.head];
    const owner = table.node ? idOf.get(table.node) : undefined;
    if (owner) {
      copy.node = owner;
      const named = nameOf.get(table.node ?? "");
      if (named) copy.title = named;
    } else {
      delete copy.node;
      // the title alone is enough to make a table belong to a connector, so a
      // copy whose title still names one is given a free name instead
      if (nodeForTable(doc, copy)) copy.title = freeName(copy.title ?? "C");
    }
    doc.tables.push(copy);
    made.push({ type: "table", id: copy.id });
  }

  return made;
}

/** A copy that shares nothing with the original, arrays and points included. */
function structuredCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
