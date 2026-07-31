/**
 * The wires inside a bundle, drawn only for what is selected.
 *
 * Drawing every strand all the time is what makes these diagrams unreadable: a
 * bundle of forty wires becomes a grey smear at any sensible zoom. So the
 * strands answer a question instead of decorating the sheet. Select a branch
 * and you see what runs through it; select a connector and you see what leaves
 * it and where each one goes.
 *
 * Nothing here is stored. The routes come from the cavity tables, so the
 * preview cannot drift out of step with the pin-outs the way a second,
 * hand-drawn representation would.
 *
 * The drawing itself is one idea: a strand is the run it follows, pushed
 * sideways by a fixed distance. Everything below exists to make that offset
 * behave at the places where a plain sideways push is not defined — where the
 * run turns, where it changes thickness, and where two branches disagree about
 * which side "sideways" is.
 */

import { colorsOf } from "@/core/colors";
import { findNode, findSegment, segmentsOf } from "@/core/doc";
import { endpointConnector, namedNodes, routeWires } from "@/core/routing";
import type { RoutedWire } from "@/core/routing";
import type { HarnessDoc, HNode, Point, Selection } from "@/core/types";
import { palette } from "./palette";
import { el } from "./svg";

/** Distance from the bundle centre to the first strand, then one per lane. */
const BUNDLE_EDGE = 6.5;
const STRAND_GAP = 2.9;
const STRAND_W = 2.2;
/**
 * Each strand is laid on a stroke of sheet colour first. Without it a white or
 * a yellow wire is nearly invisible against the bundle, and two neighbouring
 * strands of similar colour merge into one thick line: the gap between wires
 * has to be drawn, not merely left.
 */
const CASING_W = STRAND_W + 1.8;
/**
 * Radius of the fillet where a run changes direction.
 *
 * Wire is stiff: it has a bend radius, and a harness laid on a board turns in a
 * curve. The branch itself is drawn with this same fillet — it lives here
 * because the strands have to agree with it, and a strand that turns on a
 * different radius from the cable it belongs to reads as a mistake.
 */
export const BEND_R = 16;
/** A bend can tighten as a strand cuts the inside of a corner, but not to a point. */
const MIN_BEND_R = 3.5;
/**
 * How far the meeting point of two offset lines may sit from the node before
 * the corner is cut off instead. At a hairpin that point runs away to infinity,
 * and a strand that shoots off the sheet is worse than a blunt corner.
 */
const MITER_LIMIT = 2.6;
/** Fallback for a colour cell that names nothing recognizable. */
const UNKNOWN = "#9aa3ad";

/** The wires a selection is asking about, or an empty list when it asks about nothing. */
function wiresFor(doc: HarnessDoc, sel: Selection | null, routes: RoutedWire[]): RoutedWire[] {
  if (!sel) return [];

  if (sel.type === "segment") {
    return routes.filter((r) => r.path.includes(sel.id));
  }

  if (sel.type === "node" || sel.type === "table") {
    const nodeId = sel.type === "node" ? sel.id : (doc.tables.find((t) => t.id === sel.id)?.node ?? "");
    if (!nodeId || !findNode(doc, nodeId)) return [];
    const byName = namedNodes(doc);
    const own = new Set(segmentsOf(doc, nodeId).map((s) => s.id));
    return routes.filter((r) => {
      if (r.path.some((id) => own.has(id))) return true;
      // a wire ending on this very node, even before any branch is drawn
      const a = byName.get(endpointConnector(r.wire.from));
      const b = byName.get(endpointConnector(r.wire.to));
      return a?.id === nodeId || b?.id === nodeId;
    });
  }

  return [];
}

/**
 * Lane each wire occupies, handed out again in every branch.
 *
 * The rule is that the innermost lane of a branch always sits the same fixed
 * distance from it, so a spur carrying one wire draws that wire against the
 * bundle instead of holding the wide lane it needed back on the trunk.
 *
 * Within a branch the longer a wire runs the closer in it sits, which is how a
 * harness is built up: what goes the whole way is laid first and ends up in the
 * core, and what peels off early is added on the outside. The order is the same
 * in every branch, so closing up can never make two strands cross. They only
 * ever compact.
 *
 * Branch count stands in when a length has not been filled in, so an
 * undimensioned drawing still orders by reach instead of by the order the
 * tables happen to be in.
 */
function lanes(shown: readonly RoutedWire[]): Map<string, Map<number, number>> {
  const reach = (r: RoutedWire): number => r.lengthMm ?? r.path.length;
  const order = [...shown].sort((a, b) => reach(b) - reach(a) || a.wire.index - b.wire.index);

  const out = new Map<string, Map<number, number>>();
  for (const route of order) {
    for (const seg of route.path) {
      let rank = out.get(seg);
      if (!rank) {
        rank = new Map<number, number>();
        out.set(seg, rank);
      }
      rank.set(route.wire.index, rank.size);
    }
  }
  return out;
}

/* ---------------- the run a strand follows ---------------- */

/** One branch of a route, in the direction the wire travels along it. */
interface Step {
  seg: string;
  from: HNode;
  to: HNode;
  /** unit vector from `from` to `to` */
  dir: Point;
  len: number;
  /** true when the wire travels the branch the way the document stores it */
  forward: boolean;
}

/** The branches of a route, walked from one end. Branches of no length drop out. */
function walk(doc: HarnessDoc, route: RoutedWire, startNodeId: string): Step[] {
  const out: Step[] = [];
  let at = startNodeId;
  for (const segId of route.path) {
    const seg = findSegment(doc, segId);
    const from = findNode(doc, at);
    if (!seg || !from) break;
    const nextId = seg.a === at ? seg.b : seg.a;
    const to = findNode(doc, nextId);
    if (!to) break;
    const len = Math.hypot(to.x - from.x, to.y - from.y);
    if (len > 0.01) {
      const dir = { x: (to.x - from.x) / len, y: (to.y - from.y) / len };
      out.push({ seg: segId, from, to, dir, len, forward: seg.a === at });
    }
    at = nextId;
  }
  return out;
}

/** Unit vector to the left of a direction. */
const leftOf = (d: Point): Point => ({ x: -d.y, y: d.x });

/* ---------------- which side of each branch the strands run on ---------------- */

/**
 * The side of every branch the band of strands runs on.
 *
 * This is the whole difficulty, and it is not a matter of taste. A side has to
 * be a property of the branch, because every strand in a branch must be on the
 * same side of it or the band comes apart. But continuity is a property of the
 * route: a wire crossing a node wants the side it arrives on and the side it
 * leaves on to be the same side, or it swings across the cable.
 *
 * Those two cannot always both hold. At a node where three branches meet, all
 * three pairs can carry wires, and no assignment of one side per branch keeps
 * every pair continuous — it is a triangle asking to be two-coloured. So a
 * crossing has to happen somewhere, and the only question is where.
 *
 * The answer is: where the fewest wires are. Every pair of branches a wire runs
 * through in one go is a wish for continuity, weighted by how many wires wish
 * it, and the wishes are granted heaviest first. The busy trunk of a harness
 * comes out continuous and a lightly used corner takes the crossing, drawn as a
 * short diagonal at the node where it reads as wires changing branch rather
 * than as a wobble in the run.
 *
 * The whole assignment is then flipped, if it helps, so that the band settles
 * on the inside of most bends — the shorter way round, and where wire lies.
 */
function bundleSides(
  doc: HarnessDoc,
  routes: readonly RoutedWire[],
  byName: Map<string, HNode>,
): Map<string, Point> {
  const runs: Step[][] = [];
  for (const route of routes) {
    const start = byName.get(endpointConnector(route.wire.from));
    if (start && route.path.length) runs.push(walk(doc, route, start.id));
  }

  // a wish is "these two branches agree" or "these two branches disagree", the
  // sense depending on whether either is travelled against the way it is stored
  const wishes = new Map<string, { a: string; b: string; apart: boolean; weight: number }>();
  for (const run of runs) {
    for (let i = 1; i < run.length; i++) {
      const a = run[i - 1]!;
      const b = run[i]!;
      const key = a.seg < b.seg ? `${a.seg}|${b.seg}` : `${b.seg}|${a.seg}`;
      const seen = wishes.get(key);
      if (seen) seen.weight++;
      else wishes.set(key, { a: a.seg, b: b.seg, apart: a.forward !== b.forward, weight: 1 });
    }
  }

  // union-find carrying, for each branch, whether it faces its group's leader
  const up = new Map<string, string>();
  const flipped = new Map<string, boolean>();
  for (const s of doc.segments) up.set(s.id, s.id);
  const leader = (id: string): { of: string; apart: boolean } => {
    let of = id;
    let apart = false;
    for (;;) {
      const next = up.get(of);
      if (next === undefined || next === of) return { of, apart };
      apart = apart !== (flipped.get(of) ?? false);
      of = next;
    }
  };

  for (const wish of [...wishes.values()].sort((x, y) => y.weight - x.weight)) {
    const a = leader(wish.a);
    const b = leader(wish.b);
    // already in one group: the wish is either already granted or outvoted, and
    // either way there is nothing left to decide
    if (a.of === b.of) continue;
    // b's whole group swings behind a's, by however much it takes to leave the
    // two branches of this wish related the way the wish asks
    up.set(b.of, a.of);
    flipped.set(b.of, (a.apart !== b.apart) !== wish.apart);
  }

  const sides = new Map<string, Point>();
  for (const s of doc.segments) {
    const a = findNode(doc, s.a);
    const b = findNode(doc, s.b);
    if (!a || !b) continue;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!len) continue;
    const n = leftOf({ x: (b.x - a.x) / len, y: (b.y - a.y) / len });
    const away = leader(s.id).apart ? -1 : 1;
    sides.set(s.id, { x: n.x * away, y: n.y * away });
  }

  // one vote per bend per group: is the band on the inside of it?
  const inside = new Map<string, number>();
  for (const run of runs) {
    for (let i = 1; i < run.length; i++) {
      const a = run[i - 1]!;
      const turn = a.dir.x * run[i]!.dir.y - a.dir.y * run[i]!.dir.x;
      const side = sides.get(a.seg);
      if (!side || Math.abs(turn) < 1e-6) continue;
      const left = leftOf(a.dir);
      const onLeft = side.x * left.x + side.y * left.y > 0 ? 1 : -1;
      const group = leader(a.seg).of;
      inside.set(group, (inside.get(group) ?? 0) + (turn > 0 ? onLeft : -onLeft));
    }
  }
  for (const [id, side] of sides) {
    if ((inside.get(leader(id).of) ?? 0) < 0) sides.set(id, { x: -side.x, y: -side.y });
  }
  return sides;
}

/* ---------------- the strand itself ---------------- */

/** A vertex of a strand, with the radius its corner is rounded to. */
interface Corner extends Point {
  r: number;
}

/**
 * The corners of one strand: the run it follows, offset sideways.
 *
 * A sideways push is only defined along a straight, so the whole shape is
 * decided at the nodes, and there are exactly three things that can happen at
 * one.
 *
 * The run turns, and the two offset lines meet: the meeting point is the
 * corner, which is what keeps the strand at its distance right through the
 * bend instead of cutting inside it. It is rounded on the radius of the bend it
 * is on — tighter than the cable on the inside of a corner, wider on the
 * outside — so the strands stay parallel to the cable and to each other around
 * a turn rather than fanning out and closing up again.
 *
 * The run goes straight on but the strand's distance changes, because wires
 * left the bundle at the node or because the side flipped: the change is spread
 * over a short ramp centred on the node. Long enough to be a diagonal and not a
 * step, short enough to stay a thing that happens at the junction.
 *
 * The turn is too sharp for the lines to meet anywhere sensible: the corner is
 * cut off instead, which is what a mitre limit is for.
 */
function strandCorners(
  run: readonly Step[],
  gap: (i: number) => number,
  sides: Map<string, Point>,
): Corner[] {
  const out: Corner[] = [];
  const add = (p: Point, r: number): void => {
    out.push({ x: p.x, y: p.y, r });
  };
  /** The point of `node` as seen from branch `i`: pushed out by that branch's gap. */
  const off = (i: number, node: Point): Point => {
    const side = sides.get(run[i]!.seg) ?? { x: 0, y: 0 };
    const d = gap(i);
    return { x: node.x + side.x * d, y: node.y + side.y * d };
  };
  const along = (p: Point, d: Point, k: number): Point => ({ x: p.x + d.x * k, y: p.y + d.y * k });

  add(off(0, run[0]!.from), 0);

  for (let i = 1; i < run.length; i++) {
    const before = run[i - 1]!;
    const after = run[i]!;
    const node = after.from;
    const start = off(i - 1, node);
    const end = off(i, node);
    const turn = before.dir.x * after.dir.y - before.dir.y * after.dir.x;
    const widest = Math.max(gap(i - 1), gap(i), 1);

    if (Math.abs(turn) > 1e-6) {
      const step = ((end.x - start.x) * after.dir.y - (end.y - start.y) * after.dir.x) / turn;
      const meet = along(start, before.dir, step);
      if (Math.hypot(meet.x - node.x, meet.y - node.y) <= widest * MITER_LIMIT) {
        const left = leftOf(before.dir);
        const side = sides.get(before.seg) ?? { x: 0, y: 0 };
        const onLeft = side.x * left.x + side.y * left.y > 0;
        // the inside of a corner is the left of it when the run turns left
        const cutting = onLeft === turn > 0;
        const arm = (gap(i - 1) + gap(i)) / 2;
        add(meet, cutting ? Math.max(MIN_BEND_R, BEND_R - arm) : BEND_R + arm);
        continue;
      }
      // a hairpin: the lines meet somewhere off the sheet, so blunt the corner
      add(start, MIN_BEND_R);
      add(end, MIN_BEND_R);
      continue;
    }

    if (before.dir.x * after.dir.x + before.dir.y * after.dir.y < 0) {
      // the run doubles back on itself, which is a drawing fault rather than a
      // shape to be clever about
      add(start, 0);
      add(end, 0);
      continue;
    }

    const shift = Math.hypot(end.x - start.x, end.y - start.y);
    if (shift < 0.05) continue; // straight on at the same distance: no corner at all
    const ramp = Math.min(Math.max(shift * 0.9, 5), 16, before.len * 0.45, after.len * 0.45);
    add(along(start, before.dir, -ramp), ramp * 0.75);
    add(along(end, after.dir, ramp), ramp * 0.75);
  }

  const last = run[run.length - 1]!;
  add(off(run.length - 1, last.to), 0);
  return out;
}

/** Drops points that repeat, which would otherwise make a corner of nothing. */
function dedupe(points: readonly Corner[]): Corner[] {
  const out: Corner[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 0.05) out.push({ ...p });
    else last.r = Math.max(last.r, p.r);
  }
  return out;
}

const lerp = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

const fmt = (p: Point): string => `${p.x.toFixed(1)},${p.y.toFixed(1)}`;

/**
 * An SVG path through the corners, each rounded on its own radius. The corner
 * is cut back along both its arms and bridged with a quadratic curve through
 * the original vertex — the same fillet the branch itself is drawn with, so the
 * two agree — and the cut shrinks on short arms so a brief stretch between two
 * junctions cannot round itself away entirely.
 */
function roundedPath(input: readonly Corner[]): string {
  const p = dedupe(input);
  if (p.length < 2) return "";
  if (p.length === 2) return `M${fmt(p[0]!)} L${fmt(p[1]!)}`;

  let d = `M${fmt(p[0]!)}`;
  for (let i = 1; i < p.length - 1; i++) {
    const prev = p[i - 1]!;
    const curr = p[i]!;
    const next = p[i + 1]!;
    const inLen = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    const outLen = Math.hypot(next.x - curr.x, next.y - curr.y);
    const r = Math.min(curr.r, inLen / 2, outLen / 2);
    if (r < 0.05) {
      d += ` L${fmt(curr)}`;
      continue;
    }
    d += ` L${fmt(lerp(curr, prev, r / inLen))} Q${fmt(curr)} ${fmt(lerp(curr, next, r / outLen))}`;
  }
  return d + ` L${fmt(p[p.length - 1]!)}`;
}

/**
 * Draws the strands for the current selection. Returns how many wires were
 * shown, so the interface can say so rather than leaving the user to count.
 */
export function drawWirePreview(doc: HarnessDoc, sel: Selection | null, parent: SVGGElement): number {
  const routes = routeWires(doc);
  const wanted = wiresFor(doc, sel, routes);
  if (!wanted.length) return 0;

  const laneOf = lanes(wanted);
  const byName = namedNodes(doc);
  // decided from every wire in the drawing, not only the ones on show, so the
  // band does not jump to the other side of the cable as the selection changes
  const sides = bundleSides(doc, routes, byName);

  for (const route of wanted) {
    const start = byName.get(endpointConnector(route.wire.from));
    if (!start || !route.path.length) continue;

    const run = walk(doc, route, start.id);
    if (!run.length) continue;
    const gap = (i: number): number =>
      BUNDLE_EDGE + (laneOf.get(run[i]!.seg)?.get(route.wire.index) ?? 0) * STRAND_GAP;

    const corners = strandCorners(run, gap, sides);
    if (corners.length < 2) continue;
    const d = roundedPath(corners);
    if (!d) continue;

    const bands = colorsOf(route.wire.color) ?? [UNKNOWN];
    const base = bands[0] ?? UNKNOWN;
    const stroke = { d, fill: "none", "pointer-events": "none", "stroke-linecap": "round" };

    el("path", { ...stroke, stroke: palette().paper, "stroke-width": CASING_W }, parent);
    el("path", { ...stroke, stroke: base, "stroke-width": STRAND_W }, parent);

    // A tracer is a second colour on the same wire, drawn as a fine core along
    // the base rather than as dashes: at this size dashes turn into speckle and
    // a bundle of striped wires reads as static.
    if (bands[1]) {
      el("path", { ...stroke, stroke: bands[1], "stroke-width": STRAND_W * 0.45 }, parent);
    }
  }
  return wanted.length;
}
