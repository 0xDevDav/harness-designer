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
import { declaredColor, findNode, findSegment, nodeDegree, segmentPath, segmentsOf } from "@/core/doc";
import { endpointConnector, namedNodes, routeWires } from "@/core/routing";
import type { RoutedWire } from "@/core/routing";
import type { HarnessDoc, Point, Rect, Selection } from "@/core/types";
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
 * Share of every repeat the first colour holds.
 *
 * It is the ground the wire is made of; the rest are what is printed on it and
 * divide what is left. Equal bands would say a four-colour wire is quartered,
 * and that is not what one looks like.
 *
 * A wire of two is mostly its own colour with a good stripe of the other, so
 * the ground keeps more of the repeat than it does once there are marks to fit
 * in beside it.
 */
const BAND_GROUND_PAIR = 0.7;
const BAND_GROUND = 0.5;
/** How far a banded wire runs before its pattern of marks begins again. */
const BAND_PERIOD = 15;
/** How far the far edge of a mark runs ahead of its near one, which is its lean. */
const SPIRAL_LEAN = 3.5;
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
/**
 * How wide a mark has to come out on screen before it is worth drawing, in
 * screen pixels.
 *
 * Below it the marks of a wire are narrower than the pixels they would be drawn
 * on: what appears is not a banded wire but a smear the colour of the average
 * of its bands, which is not information. The wire keeps its main colour, which
 * is the one the eye is following at that size anyway, and the bands come back
 * as soon as there is room to see them.
 */
const MARK_MIN_PX = 1;

/**
 * What can actually be seen: how big a unit of the drawing comes out on screen,
 * and which part of the sheet is in the window.
 *
 * The strands are drawn to it rather than to the whole sheet. A bundle of
 * banded wires is tens of thousands of separate marks, and the ones off the
 * edge of the window cost exactly what the ones in front of the reader cost and
 * show nothing at all. Left out, everything is drawn, which is what a caller
 * with no window — a test, an export — should get.
 */
export interface Sight {
  /** screen pixels to one unit of the drawing */
  scale: number;
  /** the part of the drawing in the window, in the drawing's own units */
  visible: Rect;
}

/** True when a box lies wholly outside the window, with room to spare. */
function outOfSight(
  sight: Sight | null,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  pad: number,
): boolean {
  if (!sight) return false;
  const v = sight.visible;
  return x1 < v.x - pad || x0 > v.x + v.w + pad || y1 < v.y - pad || y0 > v.y + v.h + pad;
}

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

/* ---------------- the run a strand follows ---------------- */

/**
 * One straight stretch of a route, in the direction the wire travels along it.
 *
 * A branch that bends contributes several of these, all naming the same branch,
 * which is what keeps them on one lane and one side of it. `node` and `endNode`
 * are filled in only where a stretch really does start or end at a node, so a
 * bend can be told from a junction by looking rather than by counting.
 */
interface Step {
  seg: string;
  from: Point;
  to: Point;
  /** unit vector from `from` to `to` */
  dir: Point;
  len: number;
  /** true when the wire travels the branch the way the document stores it */
  forward: boolean;
  node: string;
  endNode: string;
  /**
   * The route crossed a joint to get here, so nothing joins this stretch to the
   * one before it. Two connectors plugged together are not a wire: the circuit
   * carries on, the wire does not.
   */
  crossed: boolean;
}

/** The stretches of a route, walked from one end. Stretches of no length drop out. */
function walk(doc: HarnessDoc, route: RoutedWire, startNodeId: string): Step[] {
  const out: Step[] = [];
  let at = startNodeId;
  for (const segId of route.path) {
    const seg = findSegment(doc, segId);
    if (!seg) break;
    // a branch that does not touch where the walk stands is the far side of a
    // joint, and the walk steps across to the mate to carry on
    let crossed = false;
    if (seg.a !== at && seg.b !== at) {
      const mate = findNode(doc, at)?.mate;
      if (!mate || (seg.a !== mate && seg.b !== mate)) break;
      at = mate;
      crossed = true;
    }
    const nextId = seg.a === at ? seg.b : seg.a;
    if (!findNode(doc, at) || !findNode(doc, nextId)) break;
    const forward = seg.a === at;
    const path = segmentPath(doc, seg);
    if (!path) break;
    if (!forward) path.reverse();

    const before = out.length;
    for (let i = 1; i < path.length; i++) {
      const from = path[i - 1]!;
      const to = path[i]!;
      const len = Math.hypot(to.x - from.x, to.y - from.y);
      if (len <= 0.01) continue;
      out.push({
        seg: segId,
        from,
        to,
        dir: { x: (to.x - from.x) / len, y: (to.y - from.y) / len },
        len,
        forward,
        node: i === 1 ? at : "",
        endNode: i === path.length - 1 ? nextId : "",
        crossed: crossed && out.length === before,
      });
    }
    at = nextId;
  }
  return out;
}

/** Unit vector to the left of a direction. */
const leftOf = (d: Point): Point => ({ x: -d.y, y: d.x });
const back = (d: Point): Point => ({ x: -d.x, y: -d.y });

/**
 * The side of the bundle a stretch runs on, as a vector.
 *
 * The side is a property of the branch, but a branch that bends has no single
 * perpendicular, so what is stored per branch is which of its two sides — as a
 * sign against the direction the document stores it in — and the vector is
 * worked out afresh on each stretch. That is what carries the band round a bend
 * inside a branch without it changing sides halfway along.
 */
function sideAt(sides: Map<string, number>, step: Step): Point {
  const sign = (sides.get(step.seg) ?? 1) * (step.forward ? 1 : -1);
  const n = leftOf(step.dir);
  return { x: n.x * sign, y: n.y * sign };
}

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
function bundleSides(doc: HarnessDoc, runs: readonly Step[][]): Map<string, number> {
  // a wish is "these two branches agree" or "these two branches disagree", the
  // sense depending on whether either is travelled against the way it is stored.
  // Two stretches of the same branch ask for nothing: they are one side already.
  const wishes = new Map<string, { a: string; b: string; apart: boolean; weight: number }>();
  for (const run of runs) {
    for (let i = 1; i < run.length; i++) {
      const a = run[i - 1]!;
      const b = run[i]!;
      // two stretches of one branch are one side already, and two with a joint
      // between them never touch: neither has anything to ask of the other
      if (a.seg === b.seg || b.crossed) continue;
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

  const sides = new Map<string, number>();
  for (const s of doc.segments) sides.set(s.id, leader(s.id).apart ? -1 : 1);

  // one vote per turn per group: is the band on the inside of it? Turns inside
  // a branch are left out — the band has no choice there, so it has no opinion.
  const inside = new Map<string, number>();
  for (const run of runs) {
    for (let i = 1; i < run.length; i++) {
      const a = run[i - 1]!;
      const b = run[i]!;
      if (a.seg === b.seg || b.crossed) continue;
      const turn = a.dir.x * b.dir.y - a.dir.y * b.dir.x;
      if (Math.abs(turn) < 1e-6) continue;
      const side = sideAt(sides, a);
      const left = leftOf(a.dir);
      const onLeft = side.x * left.x + side.y * left.y > 0 ? 1 : -1;
      const group = leader(a.seg).of;
      inside.set(group, (inside.get(group) ?? 0) + (turn > 0 ? onLeft : -onLeft));
    }
  }
  for (const [id, sign] of sides) {
    if ((inside.get(leader(id).of) ?? 0) < 0) sides.set(id, -sign);
  }
  return sides;
}

/* ---------------- which lane each wire takes ---------------- */

/**
 * The turn from one branch to another at a node, as an angle the lanes can be
 * sorted on.
 *
 * Measured from the branch the wires arrive along, rotating the way that leads
 * *off* the band rather than across it, and always taken the long way round so
 * that every branch at the node gets a place on one scale: a little for the
 * branch that peels away on the far side from the wires, half a turn for
 * carrying straight on, most of a turn for the branch that leaves on the same
 * side the wires are already running.
 *
 * Sorted on that scale, inner lane first, a fan-out cannot cross itself. A wire
 * turning away from the band is nearest the cable and needs to cross nothing to
 * go; one carrying straight on holds its place; one turning back over the band
 * is outermost and passes outside the others rather than through them.
 */
function fanAngle(arrive: Point, side: Point, leave: Point): number {
  // the band lies to one rotational side of the branch, and the scale has to
  // run the other way, or every wire would be sorted through the cable
  const away = arrive.x * side.y - arrive.y * side.x > 0 ? -1 : 1;
  const cross = away * (arrive.x * leave.y - arrive.y * leave.x);
  const angle = Math.atan2(cross, arrive.x * leave.x + arrive.y * leave.y);
  return angle <= 0 ? angle + 2 * Math.PI : angle;
}

/**
 * The end of each branch the lanes are ordered from.
 *
 * A branch has two ends and they can want different orders, so one has to win,
 * and it has to be the same one all the way along a run or the wires would swap
 * lanes in the middle of a straight. Spreading a single direction out from one
 * node settles it: every branch is read from its far end, away from that node,
 * which means every wire is placed by where it is *going* rather than by any
 * property of the wire itself.
 *
 * The node it spreads from is the connector the most wires end at, which is
 * both a leaf — so nothing has to interleave at the point it starts from — and
 * the one whose fan-out is worth getting right. What is left over, wires that
 * cross from one branch of a junction to another without touching the trunk,
 * takes the crossings, and there are few of those by construction.
 */
function outwardEnds(doc: HarnessDoc, runs: readonly Step[][]): Map<string, string> {
  const ends = new Map<string, number>();
  for (const run of runs) {
    if (!run.length) continue;
    for (const id of [run[0]!.node, run[run.length - 1]!.endNode]) {
      if (id) ends.set(id, (ends.get(id) ?? 0) + 1);
    }
  }
  let root = "";
  let best = -1;
  for (const node of doc.nodes) {
    const score = (ends.get(node.id) ?? 0) * 2 + (nodeDegree(doc, node.id) <= 1 ? 1 : 0);
    if (score > best) {
      best = score;
      root = node.id;
    }
  }

  const depth = new Map<string, number>([[root, 0]]);
  for (let queue = [root]; queue.length;) {
    const next: string[] = [];
    for (const at of queue) {
      for (const s of segmentsOf(doc, at)) {
        const other = s.a === at ? s.b : s.a;
        if (depth.has(other)) continue;
        depth.set(other, depth.get(at)! + 1);
        next.push(other);
      }
    }
    queue = next;
  }

  const far = new Map<string, string>();
  for (const s of doc.segments) {
    const a = depth.get(s.a) ?? Number.POSITIVE_INFINITY;
    const b = depth.get(s.b) ?? Number.POSITIVE_INFINITY;
    far.set(s.id, b >= a ? s.b : s.a);
  }
  return far;
}

/**
 * Where a wire is going, as the turns it makes from a branch outward: the fan
 * angle at the next node, then at the one after, and so on.
 *
 * Two wires that part company at the first junction are told apart by the first
 * number and never looked at again. Two that run together for three more
 * branches are told apart by the third, which is what keeps a group travelling
 * together from being shuffled at every node on the way.
 */
function goingKey(
  run: readonly Step[],
  segId: string,
  farNode: string,
  sides: Map<string, number>,
): number[] {
  const first = run.findIndex((s) => s.seg === segId);
  if (first < 0) return [];
  let last = first;
  while (last + 1 < run.length && run[last + 1]!.seg === segId) last++;
  const onward = run[last]!.endNode === farNode;

  const chain: Step[] = [];
  if (onward) for (let i = first; i < run.length; i++) chain.push(run[i]!);
  else for (let i = last; i >= 0; i--) chain.push(run[i]!);

  const key: number[] = [];
  for (let i = 1; i < chain.length; i++) {
    const a = chain[i - 1]!;
    const b = chain[i]!;
    // a turn inside a branch is not a fan-out, and a joint is not a turn at all
    if (a.seg === b.seg || (onward ? b.crossed : a.crossed)) continue;
    key.push(fanAngle(onward ? back(a.dir) : a.dir, sideAt(sides, a), onward ? b.dir : back(b.dir)));
  }
  return key;
}

/** A wire that runs out of route sorts as though it carried straight on. */
function compareKeys(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? Math.PI) - (b[i] ?? Math.PI);
    if (Math.abs(d) > 1e-6) return d;
  }
  return 0;
}

/**
 * Lane each wire occupies, handed out again in every branch.
 *
 * The innermost lane of a branch always sits the same fixed distance from it,
 * so a spur carrying one wire draws that wire against the bundle instead of
 * holding the wide lane it needed back on the trunk.
 *
 * The order within a branch is by where each wire is going, so that the wires
 * leaving at the next junction are already gathered on the side they leave
 * from. Ordering by length instead — longest innermost, on the reasoning that
 * what goes the whole way is laid first — reads well on a straight and falls
 * apart at every fork, because how far a wire runs says nothing about which way
 * it turns. A wire that had to cross the whole band to reach its branch now
 * finds itself on the outside of it already.
 *
 * Length still breaks the ties, which is what orders the wires that really are
 * going the same way, and branch count stands in when a length has not been
 * filled in so that an undimensioned drawing does not fall back on the order
 * the tables happen to be in.
 */
function lanes(
  shown: readonly RoutedWire[],
  runs: Map<number, Step[]>,
  far: Map<string, string>,
  sides: Map<string, number>,
): Map<string, Map<number, number>> {
  const reach = (r: RoutedWire): number => r.lengthMm ?? r.path.length;

  const onBranch = new Map<string, RoutedWire[]>();
  for (const route of shown) {
    for (const seg of route.path) {
      const list = onBranch.get(seg);
      if (list) list.push(route);
      else onBranch.set(seg, [route]);
    }
  }

  const out = new Map<string, Map<number, number>>();
  for (const [segId, wires] of onBranch) {
    const key = new Map<number, number[]>();
    for (const route of wires) {
      key.set(
        route.wire.index,
        goingKey(runs.get(route.wire.index) ?? [], segId, far.get(segId) ?? "", sides),
      );
    }
    const rank = new Map<number, number>();
    [...wires]
      .sort(
        (a, b) =>
          compareKeys(key.get(a.wire.index)!, key.get(b.wire.index)!) ||
          reach(b) - reach(a) ||
          a.wire.index - b.wire.index,
      )
      .forEach((route, i) => rank.set(route.wire.index, i));
    out.set(segId, rank);
  }
  return out;
}

/* ---------------- the strand itself ---------------- */

/** A vertex of a strand, with the radius the turn there is taken on. */
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
  sides: Map<string, number>,
): Corner[] {
  const out: Corner[] = [];
  const add = (p: Point, r: number): void => {
    out.push({ x: p.x, y: p.y, r });
  };
  /** A point of stretch `i`, pushed out by that stretch's own side and gap. */
  const off = (i: number, node: Point): Point => {
    const side = sideAt(sides, run[i]!);
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
        const side = sideAt(sides, before);
        const onLeft = side.x * left.x + side.y * left.y > 0;
        // the inside of a corner is the left of it when the run turns left
        const cutting = onLeft === turn > 0;
        const arm = (gap(i - 1) + gap(i)) / 2;
        // The radius the cable itself turns on here: it stops `BEND_R` short of
        // the node and curves through, so a gentle change of direction comes out
        // as a wide arc and a sharp one as a tight arc. The strands take that
        // radius and step in or out of it by their own distance, which is what
        // being concentric with the cable means and what holds the spacing of
        // the band even the whole way round.
        const lean = Math.abs(Math.atan2(turn, before.dir.x * after.dir.x + before.dir.y * after.dir.y));
        const cable = BEND_R / Math.max(Math.tan(lean / 2), 1e-3);
        add(meet, cutting ? Math.max(MIN_BEND_R, cable - arm) : cable + arm);
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
    // A lane change leans off the run by very little over a fair distance, and
    // a shallow lean wants a wide radius to be rounded at all: the two ends of
    // the ramp are asked for one that uses the whole of it, and meet in the
    // middle as a single S.
    const round = ramp / Math.max(Math.tan(Math.atan2(shift, 2 * ramp) / 2), 1e-3);
    add(along(start, before.dir, -ramp), round);
    add(along(end, after.dir, ramp), round);
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
 * A circular fillet from `a` round `vertex` to `b`, as one SVG command.
 *
 * It has to be a real arc. The obvious thing — a quadratic curve with the
 * corner as its control point — is a parabola, and two parabolas cut back by
 * amounts in the ratio of their radii are not offsets of each other but scaled
 * copies about the vertex. The gap between them closes through the turn: at the
 * apex of a right-angled bend two strands end up at seven tenths of the spacing
 * they hold on the straight, so a band that was even coming in arrives at the
 * corner squeezed and comes out even again. Concentric arcs are the same
 * distance apart the whole way round, which is what the eye is checking.
 *
 * The arms are assumed cut back equally, which is what makes the arc tangent to
 * both: the radius follows from that cut and the angle of the turn.
 */
export function fillet(a: Point, vertex: Point, b: Point): string {
  const inLen = Math.hypot(vertex.x - a.x, vertex.y - a.y);
  const outLen = Math.hypot(b.x - vertex.x, b.y - vertex.y);
  if (inLen < 0.01 || outLen < 0.01) return `L${fmt(b)}`;
  const from = { x: (vertex.x - a.x) / inLen, y: (vertex.y - a.y) / inLen };
  const to = { x: (b.x - vertex.x) / outLen, y: (b.y - vertex.y) / outLen };
  const cross = from.x * to.y - from.y * to.x;
  const half = Math.tan(Math.abs(Math.atan2(cross, from.x * to.x + from.y * to.y)) / 2);
  if (half < 1e-4) return `L${fmt(b)}`;
  const radius = Math.min(inLen, outLen) / half;
  return `A${radius.toFixed(1)},${radius.toFixed(1)} 0 0 ${cross > 0 ? 1 : 0} ${fmt(b)}`;
}

/**
 * One piece of a strand: a straight, or a circular arc turning a corner. `at`
 * is how far along the whole strand the piece begins, so a place given as a
 * distance can be found by halving the interval rather than by walking.
 */
type Piece = { at: number; len: number } & (
  | { kind: "line"; from: Point; to: Point }
  | { kind: "arc"; centre: Point; r: number; start: number; sweep: number; to: Point }
);

/**
 * A strand as shapes rather than as a string: the same run, in a form that can
 * be both written out as a path and measured along.
 *
 * Measuring is the point. The marks of a banded wire have to sit at set
 * distances along it, and the obvious way to find those places is to draw the
 * line and ask the browser — `getPointAtLength` on a real `<path>`. That works
 * and it is ruinous: the element has to be in the document to be measured, so
 * every question forces a fresh layout of a tree that the answers are
 * themselves making bigger, and the cost climbs with the square of the number
 * of marks. A trunk carrying seventy banded wires took fifteen seconds.
 *
 * A strand is only straights and circular arcs, and both are a line of school
 * trigonometry to walk along. Working them out here costs nothing, asks the
 * browser nothing, and is exact rather than sampled.
 */
interface Trail {
  start: Point;
  pieces: Piece[];
  len: number;
}

/**
 * The corners turned into pieces, each on its own radius.
 *
 * The corner is cut back along both arms by however much that radius needs at
 * that angle, and the cut shrinks on short arms so a brief stretch between two
 * junctions cannot round itself away entirely — at which point the radius
 * shrinks with it, because an arc that no longer fits has to be a tighter arc
 * rather than a wrong one.
 */
function trail(input: readonly Corner[]): Trail {
  const p = dedupe(input);
  const pieces: Piece[] = [];
  const start = p[0] ?? { x: 0, y: 0 };
  let here: Point = start;
  let along = 0;
  const put = (piece: Piece): void => {
    pieces.push(piece);
    along += piece.len;
  };
  const lineTo = (to: Point): void => {
    const len = Math.hypot(to.x - here.x, to.y - here.y);
    if (len > 1e-6) put({ kind: "line", from: here, to, len, at: along });
    here = to;
  };

  for (let i = 1; i < p.length - 1; i++) {
    const prev = p[i - 1]!;
    const curr = p[i]!;
    const next = p[i + 1]!;
    const inLen = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    const outLen = Math.hypot(next.x - curr.x, next.y - curr.y);
    const from = { x: (curr.x - prev.x) / inLen, y: (curr.y - prev.y) / inLen };
    const to = { x: (next.x - curr.x) / outLen, y: (next.y - curr.y) / outLen };
    const cross = from.x * to.y - from.y * to.x;
    const bend = Math.abs(Math.atan2(cross, from.x * to.x + from.y * to.y));
    const cut = Math.min(curr.r * Math.tan(bend / 2), inLen / 2, outLen / 2);
    if (cut < 0.05) {
      lineTo(curr);
      continue;
    }
    const a = lerp(curr, prev, cut / inLen);
    const b = lerp(curr, next, cut / outLen);
    lineTo(a);
    // Both arms are cut back by the same amount, which is what makes the arc
    // tangent to each: the radius then follows from that cut and the turn.
    const radius = cut / Math.tan(bend / 2);
    const turn = cross > 0 ? 1 : -1;
    const left = leftOf(from);
    const centre = { x: a.x + left.x * radius * turn, y: a.y + left.y * radius * turn };
    put({
      kind: "arc",
      centre,
      r: radius,
      start: Math.atan2(a.y - centre.y, a.x - centre.x),
      sweep: turn * bend,
      to: b,
      len: radius * bend,
      at: along,
    });
    here = b;
  }
  if (p.length > 1) lineTo(p[p.length - 1]!);

  return { start, pieces, len: along };
}

/** The trail written out as an SVG path. */
function pathData(t: Trail): string {
  if (!t.pieces.length) return "";
  let d = `M${fmt(t.start)}`;
  for (const piece of t.pieces) {
    d +=
      piece.kind === "line"
        ? ` L${fmt(piece.to)}`
        : ` A${piece.r.toFixed(1)},${piece.r.toFixed(1)} 0 0 ${piece.sweep > 0 ? 1 : 0} ${fmt(piece.to)}`;
  }
  return d;
}

/** The point a given distance along the trail, clamped to its two ends. */
function pointAt(t: Trail, distance: number): Point {
  const want = Math.max(0, Math.min(distance, t.len));
  // the last piece that starts at or before the distance asked for
  let lo = 0;
  let hi = t.pieces.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (t.pieces[mid]!.at <= want) lo = mid;
    else hi = mid - 1;
  }
  const piece = t.pieces[lo];
  if (piece) {
    const u = piece.len > 0 ? Math.min((want - piece.at) / piece.len, 1) : 0;
    if (piece.kind === "line") return lerp(piece.from, piece.to, u);
    const angle = piece.start + piece.sweep * u;
    return { x: piece.centre.x + Math.cos(angle) * piece.r, y: piece.centre.y + Math.sin(angle) * piece.r };
  }
  return t.start;
}

/** An SVG path through the corners, each turned on its own radius. */
function roundedPath(input: readonly Corner[]): string {
  return pathData(trail(input));
}

/** A path through the points with every corner turned on the same radius. */
export function filletedPath(points: readonly Point[], radius: number): string {
  return roundedPath(points.map((p) => ({ x: p.x, y: p.y, r: radius })));
}

/**
 * Draws the strands for the current selection. Returns how many wires were
 * shown, so the interface can say so rather than leaving the user to count.
 */
export function drawWirePreview(
  doc: HarnessDoc,
  sel: Selection | null,
  parent: SVGGElement,
  sight: Sight | null = null,
): number {
  const routes = routeWires(doc);
  const wanted = wiresFor(doc, sel, routes);
  if (!wanted.length) return 0;

  const byName = namedNodes(doc);
  const runs = new Map<number, Step[]>();
  for (const route of routes) {
    const start = byName.get(endpointConnector(route.wire.from));
    if (start && route.path.length) runs.set(route.wire.index, walk(doc, route, start.id));
  }

  // The side and the outward direction are read from every wire in the drawing,
  // not only the ones on show, so that neither the band nor the order within it
  // rearranges itself as the selection moves about. Only the lanes themselves
  // are counted from what is on show, because a lane is a place in a row and
  // the row is what you can see.
  const all = [...runs.values()];
  const sides = bundleSides(doc, all);
  const laneOf = lanes(wanted, runs, outwardEnds(doc, all), sides);

  for (const route of wanted) {
    const run = runs.get(route.wire.index);
    if (!run?.length) continue;

    // A circuit written straight through a joint is two wires, so it is drawn
    // as two: the run is cut where it crossed, and nothing is drawn between the
    // pieces, because between them there is no wire — there are two connectors
    // plugged together.
    //
    // And each of the two is drawn in the colour its own end declares. The wire
    // list keeps one colour per wire, taken from whichever table it read first,
    // which is right until a joint makes them two wires: then the far half
    // would be painted in the near half's colour, and the whole point of a
    // joint is that the colour is allowed to change there.
    const pieces = atJoints(run);
    const written = route.jointed
      ? [declaredColor(doc, route.wire.from), declaredColor(doc, route.wire.to)]
      : [];
    const colorOfPiece = (i: number): string => {
      if (!route.jointed) return route.wire.color;
      if (i === 0 && written[0]) return written[0];
      if (i === pieces.length - 1 && written[1]) return written[1];
      return route.wire.color;
    };

    pieces.forEach((piece, index) => {
      const bands = colorsOf(colorOfPiece(index)) ?? [UNKNOWN];
      const base = bands[0] ?? UNKNOWN;
      const gap = (i: number): number =>
        BUNDLE_EDGE + (laneOf.get(piece[i]!.seg)?.get(route.wire.index) ?? 0) * STRAND_GAP;

      const corners = strandCorners(piece, gap, sides);
      if (corners.length < 2) return;

      // A strand that falls outside the window is not drawn at all. It is the
      // same picture — nothing on screen changes — for a fraction of the work,
      // and on a big harness most of the strands of any selection are off the
      // edge of it.
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const c of corners) {
        x0 = Math.min(x0, c.x);
        y0 = Math.min(y0, c.y);
        x1 = Math.max(x1, c.x);
        y1 = Math.max(y1, c.y);
      }
      if (outOfSight(sight, x0, y0, x1, y1, CASING_W)) return;

      const d = roundedPath(corners);
      if (!d) return;

      const stroke = { d, fill: "none", "pointer-events": "none", "stroke-linecap": "round" };
      el("path", { ...stroke, stroke: palette().paper, "stroke-width": CASING_W }, parent);
      el("path", { ...stroke, stroke: base, "stroke-width": STRAND_W }, parent);

      // Every colour after the first is a band printed across the wire and
      // repeated along it, the way they really are: mostly the first colour,
      // marked at intervals by the others in the order they were written.
      //
      // Across and not along. Drawn lengthwise they read as more wires lying
      // beside this one, which is the one thing the preview must never say. It
      // used to draw the second colour as a fine core down the middle and drop
      // the third and fourth without a word, so "white,yellow,red,white" came
      // out exactly like "white,yellow".
      //
      // The first colour is the ground and holds half of every repeat; the rest
      // share the other half between them. It is already on, full length, so
      // only the marks are drawn: each one a dash the length of its share, with
      // as much space after it as the rest of the repeat, offset to where in the
      // repeat it belongs.
      if (bands.length < 2) return;
      const ground = bands.length === 2 ? BAND_GROUND_PAIR : BAND_GROUND;
      const share = (1 - ground) / (bands.length - 1);
      const mark = share * BAND_PERIOD;
      if (sight && mark * sight.scale < MARK_MIN_PX) return;

      // The marks lean, because on a real wire they are wound round it: seen
      // from the side a band crosses at an angle, not square. Each one is a
      // four-cornered patch with its two ends on the two edges of the wire, the
      // far edge running ahead of the near one by the lean. A patch is a shape
      // and not an approximation, so it stays exact however far in the drawing
      // is zoomed — laying thin lanes side by side instead gives a staircase
      // that shows itself the moment anyone looks closely.
      //
      // The two edges are worked out, not drawn and measured, and all the marks
      // of one colour go into one path rather than one shape each. Both for the
      // same reason: a bundle of banded wires used to put thousands of elements
      // on the sheet and ask the browser for the position of every corner of
      // every one of them, and the drawing stopped being usable long before the
      // harness stopped being ordinary.
      const near = trail(strandCorners(piece, (i) => gap(i) - STRAND_W / 2, sides));
      const far = trail(strandCorners(piece, (i) => gap(i) + STRAND_W / 2, sides));
      if (near.len < 1 || far.len < 1) return;
      const spot = (p: Point): string => `${p.x.toFixed(2)},${p.y.toFixed(2)}`;

      const lean = SPIRAL_LEAN / near.len;
      /** The place on the far edge opposite a distance along the near one. */
      const across = (along: number): Point => pointAt(far, Math.min(along / near.len + lean, 1) * far.len);

      bands.slice(1).forEach((color, k) => {
        const begins = (ground + k * share) * BAND_PERIOD;
        let marks = "";
        for (let along = begins; along + mark < near.len; along += BAND_PERIOD) {
          const from = pointAt(near, along);
          // one mark is smaller than the slack allowed here, so its own corner
          // is enough to place it
          if (outOfSight(sight, from.x, from.y, from.x, from.y, BAND_PERIOD)) continue;
          marks +=
            `M${spot(from)} L${spot(across(along))}` +
            ` L${spot(across(along + mark))} L${spot(pointAt(near, along + mark))}Z`;
        }
        if (marks) el("path", { d: marks, fill: color, "pointer-events": "none" }, parent);
      });
    });
  }
  return wanted.length;
}

/** The run cut into the separate wires it is really made of, one per joint crossed. */
function atJoints(run: readonly Step[]): Step[][] {
  const pieces: Step[][] = [];
  for (const step of run) {
    if (step.crossed || !pieces.length) pieces.push([]);
    pieces[pieces.length - 1]!.push(step);
  }
  return pieces;
}
