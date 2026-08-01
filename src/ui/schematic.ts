/**
 * Interaction in the schematic view.
 *
 * Far less than the sheet allows, on purpose: the schematic is read, not
 * drawn. What can be done here is look — pan, zoom, pick a connector or a wire
 * to see what it is on the formboard — and move a box, which is the one thing
 * about the schematic that is a decision rather than a consequence.
 *
 * Everything picked goes through the ordinary selection, so the sheet lights up
 * without knowing this view exists. A wire is the exception: it is not an
 * element of the document — it is what two cavity tables say between them — so
 * it is held by the schematic renderer and read back by the sheet.
 */
import { snapTo } from "@/core/geometry";
import type { Store } from "@/core/store";
import type { Point, Selection } from "@/core/types";
import type { SchemBox } from "@/core/schematic";
import type { SchematicRenderer } from "@/render/schematic";

/** Below this the movement was a click, not a drag. */
const DRAG_THRESHOLD_PX = 3;
const WHEEL_LINE_PX = 16;
const WHEEL_PAGE_PX = 400;

interface BoxDrag {
  pointerId: number;
  name: string;
  /** offset between pointer and box corner, in schematic coordinates */
  ox: number;
  oy: number;
  sx: number;
  sy: number;
  live: boolean;
}

interface PanState {
  pointerId: number;
  sx: number;
  sy: number;
  vx: number;
  vy: number;
}

export interface SchematicInteractionOptions {
  store: Store;
  schematic: SchematicRenderer;
  svg: SVGSVGElement;
  /** the wire in hand changed: the sheet has to light up, or stop */
  onFocusChange(): void;
  /** double click on a box: show the same connector on the sheet */
  onReveal?(selection: Selection): void;
}

export function attachSchematicInteraction(opts: SchematicInteractionOptions): () => void {
  const { store, schematic, svg } = opts;
  let drag: BoxDrag | null = null;
  let pan: PanState | null = null;
  let lastClick = { time: 0, x: 0, y: 0 };

  const attrOf = (target: EventTarget | null, kind: string): string | null => {
    const el = target instanceof Element ? target.closest(`[data-sch="${kind}"]`) : null;
    return el?.getAttribute("data-id") ?? null;
  };
  /** Either a box or one of its cavity rows: both stand for the same connector. */
  const boxIdOf = (target: EventTarget | null): string | null =>
    attrOf(target, "pin") ?? attrOf(target, "box");

  /** What picking a box means to the rest of the application. */
  const selectionForBox = (box: SchemBox): Selection | null => {
    if (box.nodeId) return { type: "node", id: box.nodeId };
    return box.tableId ? { type: "table", id: box.tableId } : null;
  };

  const focusWire = (id: string | null): void => {
    if (schematic.focusedWire === id) return;
    schematic.focusedWire = id;
    schematic.requestRedraw();
    opts.onFocusChange();
  };

  const releaseCapture = (pointerId: number): void => {
    try {
      if (svg.hasPointerCapture(pointerId)) svg.releasePointerCapture(pointerId);
    } catch {
      // already released: harmless
    }
  };

  const onPointerDown = (ev: PointerEvent): void => {
    if (ev.button !== 0 && ev.button !== 1) return;
    const at = schematic.screenToWorld(ev);

    const now = ev.timeStamp;
    const second =
      ev.button === 0 &&
      now - lastClick.time < 400 &&
      Math.abs(ev.clientX - lastClick.x) < 6 &&
      Math.abs(ev.clientY - lastClick.y) < 6;
    lastClick = { time: now, x: ev.clientX, y: ev.clientY };

    const wireId = ev.button === 0 ? attrOf(ev.target, "wire") : null;
    const boxId = boxIdOf(ev.target);
    const box = boxId ? schematic.model().byName.get(boxId) : null;

    if (box && ev.button === 0) {
      const selection = selectionForBox(box);
      store.select(selection);
      focusWire(null);
      if (second) {
        lastClick.time = 0;
        if (selection) opts.onReveal?.(selection);
        return;
      }
      drag = {
        pointerId: ev.pointerId,
        name: box.id,
        ox: at.x - box.x,
        oy: at.y - box.y,
        sx: ev.clientX,
        sy: ev.clientY,
        live: false,
      };
      svg.setPointerCapture(ev.pointerId);
      return;
    }

    if (wireId) {
      // a wire is not an element of the document, so nothing else can be
      // selected while one is in hand: the two picks would light up two
      // different things on the sheet at once
      store.select(null);
      focusWire(schematic.focusedWire === wireId ? null : wireId);
      return;
    }

    if (ev.button === 0) {
      store.select(null);
      focusWire(null);
    }
    pan = { pointerId: ev.pointerId, sx: ev.clientX, sy: ev.clientY, ...startPan(schematic) };
    svg.setPointerCapture(ev.pointerId);
  };

  const onPointerMove = (ev: PointerEvent): void => {
    if (pan && pan.pointerId === ev.pointerId) {
      schematic.setPan(pan.vx + (ev.clientX - pan.sx), pan.vy + (ev.clientY - pan.sy));
      return;
    }
    if (!drag || drag.pointerId !== ev.pointerId) return;

    if (!drag.live) {
      if (
        Math.abs(ev.clientX - drag.sx) < DRAG_THRESHOLD_PX &&
        Math.abs(ev.clientY - drag.sy) < DRAG_THRESHOLD_PX
      ) {
        return;
      }
      store.beginLive();
      drag.live = true;
    }

    const at = schematic.screenToWorld(ev);
    const name = drag.name;
    const x = snapTo(at.x - drag.ox, store.snapEnabled);
    const y = snapTo(at.y - drag.oy, store.snapEnabled);
    store.live((doc) => {
      const placed: Record<string, Point> = doc.schematic ?? (doc.schematic = {});
      placed[name] = { x, y };
    }, "schematic");
  };

  const endPointer = (ev: PointerEvent, aborted: boolean): void => {
    if (pan && pan.pointerId === ev.pointerId) pan = null;
    if (drag && drag.pointerId === ev.pointerId) {
      if (drag.live) {
        if (aborted) store.cancelLive();
        else store.endLive("schematic");
      }
      drag = null;
    }
    releaseCapture(ev.pointerId);
  };

  const onPointerUp = (ev: PointerEvent): void => endPointer(ev, false);
  const onPointerCancel = (ev: PointerEvent): void => endPointer(ev, true);

  const onWheel = (ev: WheelEvent): void => {
    ev.preventDefault();
    const unit = ev.deltaMode === 1 ? WHEEL_LINE_PX : ev.deltaMode === 2 ? WHEEL_PAGE_PX : 1;
    const factor = Math.min(5, Math.max(0.2, Math.pow(1.0015, -ev.deltaY * unit)));
    schematic.zoomBy(factor, { x: ev.clientX, y: ev.clientY });
  };

  const cancelGestures = (): void => {
    if (drag?.live) store.cancelLive();
    drag = null;
    pan = null;
  };

  svg.addEventListener("pointerdown", onPointerDown);
  svg.addEventListener("pointermove", onPointerMove);
  svg.addEventListener("pointerup", onPointerUp);
  svg.addEventListener("pointercancel", onPointerCancel);
  svg.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("blur", cancelGestures);
  document.addEventListener("pointerup", onPointerUp);

  return () => {
    svg.removeEventListener("pointerdown", onPointerDown);
    svg.removeEventListener("pointermove", onPointerMove);
    svg.removeEventListener("pointerup", onPointerUp);
    svg.removeEventListener("pointercancel", onPointerCancel);
    svg.removeEventListener("wheel", onWheel);
    window.removeEventListener("blur", cancelGestures);
    document.removeEventListener("pointerup", onPointerUp);
    cancelGestures();
  };
}

const startPan = (schematic: SchematicRenderer): { vx: number; vy: number } => {
  const at = schematic.pan();
  return { vx: at.x, vy: at.y };
};
