/**
 * The one clipping the application is holding, and putting it down.
 *
 * It lives in memory and not in the system clipboard on purpose. What is copied
 * is a piece of a document — nodes, branches, tables with their references
 * between them — and the system clipboard carries text. Going through it would
 * mean inventing a serialization of half the model, and reading back whatever
 * else the user had copied meanwhile.
 */
import type { AppContext } from "@/app/context";
import type { Clipping } from "@/core/clipboard";
import { countOf, isEmptyClipping, pasteClipping } from "@/core/clipboard";
import { segmentPath } from "@/core/doc";
import { T_MAX, T_MIN, alongPolyline, clamp, projectPolyline } from "@/core/geometry";
import type { HarnessDoc, Point, Selection } from "@/core/types";

let held: Clipping | null = null;

export function hold(clip: Clipping): void {
  held = clip;
}

export function heldClipping(): Clipping | null {
  return held && !isEmptyClipping(held) ? held : null;
}

/** The branch nearest a point, and where along it that point falls. */
function branchNear(doc: HarnessDoc, at: Point): { seg: string; t: number } | null {
  let best: { seg: string; t: number } | null = null;
  let nearest = Infinity;
  for (const seg of doc.segments) {
    const path = segmentPath(doc, seg);
    if (!path) continue;
    const t = projectPolyline(path, at);
    const on = alongPolyline(path, t).point;
    const away = Math.hypot(on.x - at.x, on.y - at.y);
    if (away < nearest) {
      nearest = away;
      best = { seg: seg.id, t: clamp(t, T_MIN, T_MAX) };
    }
  }
  return best;
}

/**
 * A label copied on its own has nothing to sit on: it belongs at a point along
 * a branch, and the branch it belonged to stayed behind. It goes on the branch
 * nearest where it is being put down, which is the only reading of "here" that
 * a label has. With no branch drawn at all it is dropped.
 */
function withHosts(doc: HarnessDoc, clip: Clipping, at: Point): Clipping {
  const own = new Set(clip.segments.map((s) => s.id));
  if (!clip.inlines.some((i) => !own.has(i.seg))) return clip;
  const host = branchNear(doc, at);
  return {
    ...clip,
    inlines: clip.inlines.map((inline) =>
      own.has(inline.seg) ? inline : { ...inline, seg: host?.seg ?? "", t: host?.t ?? inline.t },
    ),
  };
}

/** Puts the held clipping down with its corner at `at`, and selects what it made. */
export function pasteHeldAt(app: AppContext, at: Point): void {
  const clip = heldClipping();
  if (!clip) {
    app.toast.error(app.t("toast.clipboardEmpty"));
    return;
  }
  let made: Selection[] = [];
  const changed = app.store.edit((doc) => {
    made = pasteClipping(doc, withHosts(doc, clip, at), at, app.store.snapEnabled);
  }, "paste");

  if (!changed || !made.length) {
    app.toast.error(app.t("toast.pasteRefused"));
    return;
  }
  // built back to front so the first thing copied ends up the primary one: the
  // strand preview and every menu are about that one
  app.store.select(made[made.length - 1]!);
  for (let i = made.length - 2; i >= 0; i--) app.store.toggle(made[i]!);
  app.refreshProps();
  const n = countOf(clip);
  app.toast.show(n === 1 ? app.t("toast.pastedOne") : app.t("toast.pasted", { n }));
}
