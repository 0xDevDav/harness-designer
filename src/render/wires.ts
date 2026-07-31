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
 * How much the turn at a junction is rounded off. Wire is stiff and does not
 * turn a square corner, so a square corner looks wrong before you can say why.
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

/**
 * Unit vector perpendicular to a branch, decided by the branch alone.
 *
 * It must not depend on which way the wire happens to travel. Taking it from
 * the direction of travel puts two wires crossing the same branch in opposite
 * senses on opposite sides of it, and one of them then has to swing right round
 * the bundle at the junction to reach the side it was assigned. That swing is
 * the hook, and no amount of smoothing at the corner removes it, because the
 * path really does double back.
 *
 * Pinning it to the sheet instead, always downwards and rightwards for a
 * vertical branch, gives every wire in a branch the same side and keeps that
 * side stable across the whole drawing.
 */
function normal(a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (!len) return { x: 0, y: 0 };
  const n = { x: -dy / len, y: dx / len };
  const flip = Math.abs(n.y) < 1e-6 ? n.x < 0 : n.y < 0;
  return flip ? { x: -n.x, y: -n.y } : n;
}

/** The nodes a wire passes through, with the perpendicular of each branch. */
function walk(doc: HarnessDoc, route: RoutedWire, startNodeId: string): { nodes: HNode[]; norms: Point[] } {
  const nodes: HNode[] = [];
  const norms: Point[] = [];
  const first = findNode(doc, startNodeId);
  if (!first) return { nodes, norms };
  nodes.push(first);

  let at = startNodeId;
  for (const segId of route.path) {
    const seg = findSegment(doc, segId);
    if (!seg) break;
    const nextId = seg.a === at ? seg.b : seg.a;
    const to = findNode(doc, nextId);
    if (!to) break;
    norms.push(normal(nodes[nodes.length - 1]!, to));
    nodes.push(to);
    at = nextId;
  }
  return { nodes, norms };
}

/**
 * Which side of the bundle the whole band runs on, decided once for the
 * selection and applied to every strand in it.
 *
 * Deciding it per wire, from the way that wire's own route turns, put one
 * strand above the bundle and the rest below it: the band came apart, and the
 * wire left on its own read as being far from the cable rather than merely on
 * the other side of it. A bundle opened up has its wires on one side, so the
 * side is a property of the view and not of each wire.
 *
 * The choice follows the majority of the turns, so the band settles on the
 * inside of the bends, which is where wire actually runs and the shorter way.
 */
function preferredSide(doc: HarnessDoc, shown: readonly RoutedWire[], byName: Map<string, HNode>): number {
  let turn = 0;
  for (const route of shown) {
    const start = byName.get(endpointConnector(route.wire.from));
    if (!start) continue;
    const { norms } = walk(doc, route, start.id);
    for (let i = 1; i < norms.length; i++) {
      const p = norms[i - 1]!;
      const c = norms[i]!;
      turn += p.x * c.y - p.y * c.x;
    }
  }
  return turn < 0 ? -1 : 1;
}

/**
 * The polyline of one wire: each branch offset on its own perpendicular, so
 * every branch honours its own innermost-lane distance.
 *
 * The two points of a branch are pulled back from its ends rather than sitting
 * on them. That is what stops a junction becoming a hook: with both points on
 * the node itself, the step from one branch's offset to the next can face
 * backwards along the wire, and the rounding turns that reversal into a loop.
 * Inset, the path always advances, and the corner is simply a corner.
 *
 * The two outermost ends are not inset, because a wire has to reach its
 * connector.
 */
function strandPoints(
  doc: HarnessDoc,
  route: RoutedWire,
  laneOf: Map<string, Map<number, number>>,
  startNodeId: string,
  side: number,
): Point[] {
  const out: Point[] = [];
  let at = startNodeId;

  route.path.forEach((segId, i) => {
    const seg = findSegment(doc, segId);
    const from = findNode(doc, at);
    if (!seg || !from) return;
    const nextId = seg.a === at ? seg.b : seg.a;
    const to = findNode(doc, nextId);
    if (!to) return;

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const d = { x: dx / len, y: dy / len };
    const n = normal(from, to);

    const lane = laneOf.get(segId)?.get(route.wire.index) ?? 0;
    const shift = (BUNDLE_EDGE + lane * STRAND_GAP) * side;
    const inset = Math.min(CORNER_R * 1.6, len * 0.3);
    const head = i === 0 ? 0 : inset;
    const tail = i === route.path.length - 1 ? 0 : inset;

    out.push({ x: from.x + n.x * shift + d.x * head, y: from.y + n.y * shift + d.y * head });
    out.push({ x: to.x + n.x * shift - d.x * tail, y: to.y + n.y * shift - d.y * tail });
    at = nextId;
  });
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

const fmt = (p: Point): string => `${p.x.toFixed(1)},${p.y.toFixed(1)}`;

/**
 * An SVG path through the points with the corners rounded off. Each corner is
 * cut back along both its arms and bridged with a quadratic curve through the
 * original vertex, the radius shrinking on short arms so a brief stretch
 * between two junctions cannot round itself away entirely.
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
    d += ` L${fmt(lerp(curr, prev, r / inLen))} Q${fmt(curr)} ${fmt(lerp(curr, next, r / outLen))}`;
  }
  return d + ` L${fmt(p[p.length - 1]!)}`;
}

/**
 * Draws the strands for the current selection. Returns how many wires were
 * shown, so the interface can say so rather than leaving the user to count.
 */
export function drawWirePreview(doc: HarnessDoc, sel: Selection | null, parent: SVGGElement): number {
  const wanted = wiresFor(doc, sel, routeWires(doc));
  if (!wanted.length) return 0;

  const laneOf = lanes(wanted);
  const byName = namedNodes(doc);
  const side = preferredSide(doc, wanted, byName);

  for (const route of wanted) {
    const start = byName.get(endpointConnector(route.wire.from));
    if (!start || !route.path.length) continue;

    const points = dedupe(strandPoints(doc, route, laneOf, start.id, side));
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
