import { findNode, segmentsOf } from "@/core/doc";
import type { HarnessDoc, HNode, Point } from "@/core/types";
import { el } from "./svg";
import { palette } from "./palette";

/**
 * Junction boot: melts the tubes meeting at a node into a single body.
 *
 * The drawing is a white band covering where the branch outlines cross, plus
 * the outer walls drawn as a mitre along the bisector between two adjacent
 * tubes. The result matches real formboards, where the tape follows the outer
 * profile of the bundle instead of stopping at a sharp corner.
 */

/** Half-width of the outer tube: half the thickness of the outline. */
const HALF = 4.5;
/** Past this angle (~150°) two lone tubes are effectively in line, so no boot. */
const FLAT = 2.62;

interface Direction {
  ux: number;
  uy: number;
  len: number;
  ang: number;
}

interface Mouth {
  /** depth of the mouth along the tube */
  L: number;
  /** spigolo in senso orario */
  a: Point;
  /** spigolo in senso antiorario */
  b: Point;
}

export function drawJunctionBoot(doc: HarnessDoc, node: HNode, parent: Element): void {
  const segments = segmentsOf(doc, node.id);
  if (segments.length < 2) return;

  const dirs: Direction[] = [];
  for (const s of segments) {
    const other = findNode(doc, s.a === node.id ? s.b : s.a);
    if (!other) continue;
    const dx = other.x - node.x;
    const dy = other.y - node.y;
    const len = Math.hypot(dx, dy);
    // two nodes on top of each other define no direction, so the tube is skipped
    if (len < 1e-6) continue;
    dirs.push({ ux: dx / len, uy: dy / len, len, ang: Math.atan2(dy, dx) });
  }
  if (dirs.length < 2) return;
  dirs.sort((p, q) => p.ang - q.ang);

  if (dirs.length === 2) {
    const first = dirs[0]!;
    const second = dirs[1]!;
    let delta = Math.abs(second.ang - first.ang);
    if (delta > Math.PI) delta = 2 * Math.PI - delta;
    if (delta > FLAT) return;
  }

  const mouths: Mouth[] = dirs.map((d) => {
    // the mouth cannot exceed half the branch, or it invades the next junction
    const L = Math.min(11, Math.max(6, d.len / 2 - 2));
    const nx = -d.uy;
    const ny = d.ux;
    return {
      L,
      a: { x: node.x + d.ux * L - nx * HALF, y: node.y + d.uy * L - ny * HALF },
      b: { x: node.x + d.ux * L + nx * HALF, y: node.y + d.uy * L + ny * HALF },
    };
  });

  const points: Point[] = [];
  const walls: [Point, Point][] = [];

  for (let i = 0; i < dirs.length; i++) {
    const j = (i + 1) % dirs.length;
    const di = dirs[i]!;
    const dj = dirs[j]!;
    const mi = mouths[i]!;
    const mj = mouths[j]!;
    points.push(mi.a, mi.b);

    let gap = dj.ang - di.ang;
    if (gap <= 0) gap += 2 * Math.PI;
    const miterDist = HALF / Math.max(Math.sin(gap / 2), 1e-4);
    const cap = Math.min(mi.L, mj.L);
    const bisector = di.ang + gap / 2;
    const reach = Math.min(miterDist, cap);
    const miter: Point = { x: node.x + Math.cos(bisector) * reach, y: node.y + Math.sin(bisector) * reach };
    points.push(miter);

    // on too narrow a wedge the mitre would fall inside the tubes, so the wall is skipped
    if (miterDist <= cap) walls.push([mi.b, miter], [miter, mj.a]);
  }

  el(
    "polygon",
    {
      points: points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" "),
      fill: palette().bundleInner,
      "pointer-events": "none",
    },
    parent,
  );

  for (const [p, q] of walls) {
    el(
      "line",
      {
        x1: p.x,
        y1: p.y,
        x2: q.x,
        y2: q.y,
        stroke: palette().bundleOuter,
        "stroke-width": 1.7,
        "stroke-linecap": "round",
        "pointer-events": "none",
      },
      parent,
    );
  }
}
