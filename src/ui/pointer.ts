/**
 * Where the pointer last was on the sheet, in the drawing's own coordinates.
 *
 * A command run from the keyboard has no event to read a position out of, and
 * "here" is exactly what pasting means. The sheet interaction already works the
 * pointer's place out on every move, so it says so here rather than everything
 * else guessing at the middle of the view.
 *
 * Empty while the pointer is off the sheet: nowhere is an honest answer, and
 * the last place it was seen before it went to a menu or the toolbar is not
 * where anyone means.
 */
import type { Point } from "@/core/types";

let at: Point | null = null;

export function notePointer(world: Point | null): void {
  at = world ? { x: world.x, y: world.y } : null;
}

export function pointerAt(): Point | null {
  return at ? { ...at } : null;
}
