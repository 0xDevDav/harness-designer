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
 */

import { colorsOf } from "@/core/colors";
import { findNode, findSegment, segmentsOf } from "@/core/doc";
import { endpointConnector, namedNodes, routeWires } from "@/core/routing";
import type { RoutedWire } from "@/core/routing";
import type { HarnessDoc, Point, Selection } from "@/core/types";
import { palette } from "./palette";
import { el } from "./svg";

/**
 * The strands run alongside the bundle rather than over it. Drawn on top they
 * fight the branch for the same pixels and neither reads; set beside it, the
 * bundle stays the drawing and the strands are the explanation of it.
 *
 * They are kept tight together, close to the bundle edge: a band of wires
 * running as one reads as a bundle opened up, while the same wires spread out
 * read as unrelated lines that happen to be parallel.
 */
const BUNDLE_EDGE = 7.5;
const STRAND_GAP = 3.6;
const STRAND_W = 2.6;
/**
 * Each strand is laid on a stroke of sheet colour first. Without it a white or
 * a yellow wire is nearly invisible against the bundle, and two neighbouring
 * strands of similar colour merge into one thick line: the gap between wires
 * has to be drawn, not merely left.
 */
const CASING_W = STRAND_W + 1.8;
/**
 * How much the lane change at a junction is rounded off. Wire is stiff and does
 * not turn a square corner, so a square corner looks wrong before you can say
 * why.
 */
const CORNER_R = 8;
/** Radius of the dot marking where a wire ends. */
const END_R = 3.4;
/** Fallback for a colour cell that names nothing recognizable. */
const UNKNOWN = "#9aa3ad";

/** The wires a selection is asking about, or an empty list when it asks about nothing. */
function wiresFor(doc: HarnessDoc, sel: Selection | null, routes: RoutedWire[]): RoutedWire[] {
  if (!sel) return [];

  if (sel.type === "segment") {
    return routes.filter((r) => r.path.includes(sel.id));
  }

  if (sel.type === "node" || sel.type === "table") {
    const nodeId =
      sel.type === "node" ? sel.id : (doc.tables.find((t) => t.id === sel.id)?.node ?? "");
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
 * Lane each wire occupies inside each branch.
 *
 * The order is the wire list's own, applied identically in every branch, which
 * is what keeps the strands parallel: were each branch to sort them for itself,
 * they would swap places at every junction and the drawing would read as a
 * knot.
 */
function lanes(routes: RoutedWire[]): Map<string, Map<number, number>> {
  const bySegment = new Map<string, number[]>();
  for (const r of routes) {
    for (const seg of r.path) {
      const list = bySegment.get(seg);
      if (list) list.push(r.wire.index);
      else bySegment.set(seg, [r.wire.index]);
    }
  }
  const out = new Map<string, Map<number, number>>();
  for (const [seg, list] of bySegment) {
    list.sort((a, b) => a - b);
    const rank = new Map<number, number>();
    list.forEach((index, i) => rank.set(index, i));
    out.set(seg, rank);
  }
  return out;
}

/**
 * Unit vector perpendicular to a→b, taken in the direction the wire travels.
 *
 * Deliberately not pinned to one side of the sheet. Doing that keeps every
 * strand below the branch while the branch is horizontal, and falls apart the
 * moment one is not: on a vertical branch "below" becomes "to the left", so the
 * wire has to cut across the bundle at each junction just to get back to the
 * side the rule demands. Following the direction of travel instead, a wire
 * stays on its own side for its whole route and only crosses where it really
 * leaves by another branch.
 */
function normal(a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  return len ? { x: -dy / len, y: dx / len } : { x: 0, y: 0 };
}

/**
 * The polyline of one wire: each branch shifted into its own lane, and a short
 * diagonal where the lane changes at a junction. That diagonal is not a defect
 * of the drawing, it is the wire actually crossing the bundle to leave by a
 * different branch.
 */
function strandPoints(
  doc: HarnessDoc,
  route: RoutedWire,
  laneOf: Map<string, Map<number, number>>,
  startNodeId: string,
): Point[] {
  const nodes: Point[] = [];
  const norms: Point[] = [];
  const shifts: number[] = [];

  let at = startNodeId;
  const first = findNode(doc, at);
  if (!first) return [];
  nodes.push(first);

  for (const segId of route.path) {
    const seg = findSegment(doc, segId);
    if (!seg) break;
    const nextId = seg.a === at ? seg.b : seg.a;
    const to = findNode(doc, nextId);
    if (!to) break;
    norms.push(normal(nodes[nodes.length - 1]!, to));
    shifts.push(BUNDLE_EDGE + (laneOf.get(segId)?.get(route.wire.index) ?? 0) * STRAND_GAP);
    nodes.push(to);
    at = nextId;
  }
  if (!norms.length) return [];

  // Which side of the bundle the wire runs on, decided once for the whole
  // route by where it turns. A wire laid round a bend takes the inside of it,
  // because that is the shorter way and wire is not stretched to go the long
  // way round for the sake of symmetry. Summing the turns rather than deciding
  // corner by corner keeps the strand on one side end to end.
  let turn = 0;
  for (let i = 1; i < norms.length; i++) {
    const p = norms[i - 1]!;
    const c = norms[i]!;
    turn += p.x * c.y - p.y * c.x;
  }
  if (turn < 0) for (let i = 0; i < shifts.length; i++) shifts[i] = -shifts[i]!;

  // One point per node, never two. Emitting the offset ends of each branch
  // separately puts two almost coincident vertices at every junction joined by
  // a stub, and rounding both ends of that stub eats it: that is where the
  // curls came from.
  const out: Point[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const nIn = norms[i - 1];
    const nOut = norms[i];
    let dir: Point;
    let dist: number;

    if (!nIn) {
      dir = nOut!;
      dist = shifts[i]!;
    } else if (!nOut) {
      dir = nIn;
      dist = shifts[i - 1]!;
    } else {
      const bx = nIn.x + nOut.x;
      const by = nIn.y + nOut.y;
      const len = Math.hypot(bx, by);
      dist = (shifts[i - 1]! + shifts[i]!) / 2;
      if (len < 0.15) {
        // the branch doubles back on itself: no bisector exists, so keep the
        // side the wire was already on rather than invent one
        dir = nOut;
      } else {
        dir = { x: bx / len, y: by / len };
        // hold the distance from the bundle constant round the corner, capped
        // so a hairpin grows a rounded elbow instead of a spike
        dist /= Math.max(dir.x * nOut.x + dir.y * nOut.y, 0.45);
      }
    }
    out.push({ x: nodes[i]!.x + dir.x * dist, y: nodes[i]!.y + dir.y * dist });
  }
  return out;
}

/** Drops points that repeat, which would otherwise make a corner of nothing. */
function dedupe(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 0.05) out.push(p);
  }
  return out;
}

const lerp = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

/**
 * An SVG path through the points with the corners rounded off.
 *
 * Each corner is cut back along both its arms and bridged with a quadratic
 * curve through the original vertex, the radius shrinking on short arms so a
 * brief stretch between two junctions cannot round itself away entirely.
 */
function roundedPath(input: readonly Point[], radius: number): string {
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
    const r = Math.min(radius, inLen / 2, outLen / 2);
    const start = lerp(curr, prev, r / inLen);
    const end = lerp(curr, next, r / outLen);
    d += ` L${fmt(start)} Q${fmt(curr)} ${fmt(end)}`;
  }
  return d + ` L${fmt(p[p.length - 1]!)}`;
}

const fmt = (p: Point): string => `${p.x.toFixed(1)},${p.y.toFixed(1)}`;

/**
 * Draws the strands for the current selection. Returns how many wires were
 * shown, so the interface can say so rather than leaving the user to count.
 */
export function drawWirePreview(
  doc: HarnessDoc,
  sel: Selection | null,
  parent: SVGGElement,
): number {
  const routes = routeWires(doc);
  const wanted = wiresFor(doc, sel, routes);
  if (!wanted.length) return 0;

  // Lanes are shared out among the wires actually on show, not among every
  // wire in the drawing. Ranking against the lot gives a single selected wire a
  // different lane in each branch, and it steps sideways halfway along for no
  // reason the eye can see.
  const laneOf = lanes(wanted);
  const byName = namedNodes(doc);

  for (const route of wanted) {
    const start = byName.get(endpointConnector(route.wire.from));
    if (!start || !route.path.length) continue;

    const points = dedupe(strandPoints(doc, route, laneOf, start.id));
    if (points.length < 2) continue;
    const d = roundedPath(points, CORNER_R);
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

    // both ends marked, because the question the preview answers is where the
    // wire goes, and a strand that fades into a bundle does not answer it
    for (const p of [points[0]!, points[points.length - 1]!]) {
      el(
        "circle",
        {
          cx: p.x,
          cy: p.y,
          r: END_R,
          fill: base,
          stroke: palette().paper,
          "stroke-width": 1.4,
          "pointer-events": "none",
        },
        parent,
      );
    }
  }
  return wanted.length;
}
