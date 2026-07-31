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
