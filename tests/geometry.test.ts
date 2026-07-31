import { describe, expect, it } from "vitest";
import {
  GRID,
  T_MAX,
  T_MIN,
  clamp,
  dist,
  inflate,
  lerpPoint,
  projectT,
  readableAngle,
  rectUnion,
  snapTo,
} from "@/core/geometry";

describe("clamp", () => {
  it("lets inner values through and cuts at the bounds", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(42, 0, 10)).toBe(10);
    expect(clamp(0, 0, 0)).toBe(0);
  });

  it("returns the upper bound when the range is inverted", () => {
    expect(clamp(5, 10, 0)).toBe(0);
  });
});

describe("snapTo", () => {
  it("snaps to the grid step when enabled", () => {
    expect(snapTo(13, true)).toBe(10);
    expect(snapTo(16, true)).toBe(20);
    expect(snapTo(-13, true)).toBe(-10);
    expect(snapTo(0, true)).toBe(0);
  });

  it("rounds up at half a step", () => {
    expect(snapTo(GRID / 2, true)).toBe(GRID);
  });

  it("returns the value untouched when disabled", () => {
    expect(snapTo(13.7, false)).toBe(13.7);
  });

  it("accepts a step other than the default", () => {
    expect(snapTo(13, true, 5)).toBe(15);
    expect(snapTo(12, true, 5)).toBe(10);
  });
});

describe("projectT", () => {
  const a = { x: 0, y: 0 };
  const b = { x: 100, y: 0 };

  it("projects a point that lies within the segment", () => {
    expect(projectT(a, b, { x: 50, y: 0 })).toBeCloseTo(0.5, 10);
    expect(projectT(a, b, { x: 30, y: 40 })).toBeCloseTo(0.3, 10);
  });

  it("clamps a projection beyond the segment to the allowed bounds", () => {
    expect(projectT(a, b, { x: -500, y: 0 })).toBe(T_MIN);
    expect(projectT(a, b, { x: 500, y: 0 })).toBe(T_MAX);
    // not even exactly on the nodes: a label must never land on one
    expect(projectT(a, b, a)).toBe(T_MIN);
    expect(projectT(a, b, b)).toBe(T_MAX);
  });

  it("returns the midpoint on a degenerate segment", () => {
    expect(projectT(a, a, { x: 99, y: 99 })).toBe(0.5);
  });

  it("works on a slanted segment", () => {
    const p = projectT({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 5, y: 5 });
    expect(p).toBeCloseTo(0.5, 10);
  });
});

describe("readableAngle", () => {
  it("normalizes into [-90, 90]", () => {
    expect(readableAngle(0)).toBeCloseTo(0, 6);
    expect(readableAngle(Math.PI / 4)).toBeCloseTo(45, 6);
    expect(readableAngle(Math.PI / 2)).toBeCloseTo(90, 6);
    expect(readableAngle(Math.PI)).toBeCloseTo(0, 6);
    expect(readableAngle(-Math.PI)).toBeCloseTo(0, 6);
    expect(readableAngle((3 * Math.PI) / 4)).toBeCloseTo(-45, 6);
    expect(readableAngle((-3 * Math.PI) / 4)).toBeCloseTo(45, 6);
  });

  it("the result always stays within the bounds", () => {
    for (let deg = -180; deg <= 180; deg += 15) {
      const out = readableAngle((deg * Math.PI) / 180);
      expect(out).toBeGreaterThanOrEqual(-90.000001);
      expect(out).toBeLessThanOrEqual(90.000001);
    }
  });
});

describe("rectUnion", () => {
  it("encloses two overlapping boxes", () => {
    expect(rectUnion({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toEqual({
      x: 0,
      y: 0,
      w: 15,
      h: 15,
    });
  });

  it("encloses two disjoint boxes, negative coordinates included", () => {
    expect(rectUnion({ x: -20, y: -5, w: 10, h: 5 }, { x: 100, y: 100, w: 10, h: 10 })).toEqual({
      x: -20,
      y: -5,
      w: 130,
      h: 115,
    });
  });

  it("is idempotent against itself", () => {
    const r = { x: 3, y: 4, w: 5, h: 6 };
    expect(rectUnion(r, r)).toEqual(r);
  });
});

describe("dist, lerpPoint, inflate", () => {
  it("euclidean distance", () => {
    expect(dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it("linear interpolation between two points", () => {
    expect(lerpPoint({ x: 0, y: 0 }, { x: 10, y: 20 }, 0.25)).toEqual({ x: 2.5, y: 5 });
  });

  it("inflates a box on every side", () => {
    expect(inflate({ x: 10, y: 10, w: 20, h: 20 }, 5)).toEqual({ x: 5, y: 5, w: 30, h: 30 });
  });
});
