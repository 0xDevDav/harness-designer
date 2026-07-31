import type { Point, Rect } from "./types";

/** Snap grid step, in document units. */
export const GRID = 10;
/** Bounds of an inline label's parametric position. */
export const T_MIN = 0.05;
export const T_MAX = 0.95;

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export const snapTo = (v: number, enabled: boolean, grid = GRID): number =>
  enabled ? Math.round(v / grid) * grid : v;

export const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Point on segment a→b at parametric position t. */
export const lerpPoint = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

/**
 * Projection of p onto segment a→b, as a t clamped to [T_MIN, T_MAX] because a
 * label must never end up sitting exactly on top of a node.
 */
export function projectT(a: Point, b: Point, p: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (!l2) return 0.5;
  return clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / l2, T_MIN, T_MAX);
}

/* ---------------- polylines ---------------- */

/**
 * A branch may bend on its way, so anything placed along one is placed by
 * distance travelled rather than by how far it is between the two ends. `t`
 * keeps meaning the same thing it always did — a fraction of the way along —
 * and on a straight branch these come out identical to the two-point versions
 * above, which is what lets a document written before bends existed keep every
 * label exactly where it was.
 */
export function polylineLength(points: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1]!, points[i]!);
  return total;
}

/** The point a fraction `t` along a polyline, and the direction of travel there. */
export function alongPolyline(points: readonly Point[], t: number): { point: Point; angle: number } {
  const first = points[0] ?? { x: 0, y: 0 };
  const last = points[points.length - 1] ?? first;
  const total = polylineLength(points);
  if (points.length < 2 || !total) {
    return { point: { ...first }, angle: Math.atan2(last.y - first.y, last.x - first.x) };
  }

  let walked = t * total;
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1]!;
    const to = points[i]!;
    const leg = dist(from, to);
    if (!leg) continue;
    if (walked <= leg || i === points.length - 1) {
      return {
        point: lerpPoint(from, to, clamp(walked / leg, 0, 1)),
        angle: Math.atan2(to.y - from.y, to.x - from.x),
      };
    }
    walked -= leg;
  }
  return { point: { ...last }, angle: 0 };
}

/**
 * The `t` of the point on a polyline nearest to `p`, clamped like `projectT`
 * because a label must never end up sitting exactly on top of a node.
 */
export function projectPolyline(points: readonly Point[], p: Point): number {
  const total = polylineLength(points);
  if (points.length < 2 || !total) return 0.5;

  let walked = 0;
  let best = 0.5;
  let bestDist = Infinity;
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1]!;
    const to = points[i]!;
    const leg = dist(from, to);
    if (!leg) continue;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const local = clamp(((p.x - from.x) * dx + (p.y - from.y) * dy) / (leg * leg), 0, 1);
    const at = lerpPoint(from, to, local);
    const away = dist(at, p);
    if (away < bestDist) {
      bestDist = away;
      best = (walked + local * leg) / total;
    }
    walked += leg;
  }
  return clamp(best, T_MIN, T_MAX);
}

/** Angle in degrees normalized to [-90, 90], so text always reads upright. */
export function readableAngle(radians: number): number {
  let deg = (radians * 180) / Math.PI;
  if (deg > 90) deg -= 180;
  if (deg < -90) deg += 180;
  return deg;
}

export function rectUnion(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

export function inflate(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, w: r.w + by * 2, h: r.h + by * 2 };
}
