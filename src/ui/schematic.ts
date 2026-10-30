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
import { cloneDoc } from "@/core/doc";
import { snapTo } from "@/core/geometry";
import { connectEnds, connectViaSplice, detailsConflict, disconnectWire, moveWireEnd } from "@/core/rewire";
import type { DetailsConflict, Prefer, RewireOutcome, WireOp } from "@/core/rewire";
import type { Store } from "@/core/store";
import type { Point, Selection } from "@/core/types";
import { portOffset, targetAt, targetLabel } from "@/core/schematic";
import type { SchemBox, SchemTarget, SchemWire } from "@/core/schematic";
import { setWireColor } from "@/core/wirecolor";
import { t } from "@/i18n";
import type { SchematicRenderer } from "@/render/schematic";
import { openColorPicker } from "./colorpicker";
import { openMenu } from "./menu";

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

/**
 * A wire in hand: picked up by an end that is already on a cavity (it moves),
 * or started from a cavity that has no wire (it is new). Either way the other
 * end is what has to be dropped on a cavity.
 */
interface WireDrag {
  pointerId: number;
  /** the point the line is drawn from: the end that stays, or the cavity it starts at */
  fixed: Point;
  sx: number;
  sy: number;
  live: boolean;
  /** the cavity last asked about and the answer, so the drawing is only asked when the pointer changes cavity */
  asked?: { key: string; ok: boolean };
  /** what is being done, with the endpoints as the tables write them */
  op: { kind: "move"; wire: SchemWire; moving: 0 | 1 } | { kind: "new"; from: string };
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
  /** something to tell the person: what was done, or why it could not be */
  notify?(message: string, kind: "info" | "error"): void;
  /**
   * The wire and the cavity it was dropped on describe it differently: which
   * details it takes, or a splice between them, or null to leave it undone.
   */
  askDetails?(conflict: DetailsConflict): Promise<Prefer | "splice" | null>;
}

export function attachSchematicInteraction(opts: SchematicInteractionOptions): () => void {
  const { store, schematic, svg } = opts;
  let drag: BoxDrag | null = null;
  let wireDrag: WireDrag | null = null;
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

  /** The two endpoints of a wire as the tables write them, in the order a move names them. */
  const endsOf = (wire: SchemWire): [string, string] => [wire.fromLabel, wire.toLabel];

  /** Does the drawing take this wire? Tried on a copy, so the answer is the real one. */
  const outcomeOf = (op: WireDrag["op"], to: string): RewireOutcome => {
    const copy = cloneDoc(store.doc);
    return op.kind === "move"
      ? moveWireEnd(copy, endsOf(op.wire), op.moving, to)
      : connectEnds(copy, op.from, to);
  };

  const clearGhost = (): void => {
    if (!schematic.ghost) return;
    schematic.ghost = null;
    schematic.requestRedraw();
  };

  /** Picks up a wire by one of its ends, or starts one from a free cavity. */
  const startWireDrag = (ev: PointerEvent): boolean => {
    if (ev.button !== 0 || !(ev.target instanceof Element)) return false;
    const model = schematic.model();

    const endEl = ev.target.closest('[data-sch="end"]');
    if (endEl) {
      const wire = model.wires.find((w) => w.id === endEl.getAttribute("data-wire"));
      const moving = endEl.getAttribute("data-end") === "1" ? 1 : 0;
      const fixed = wire?.points[moving === 0 ? wire.points.length - 1 : 0];
      if (!wire || !fixed) return false;
      wireDrag = {
        pointerId: ev.pointerId,
        fixed,
        sx: ev.clientX,
        sy: ev.clientY,
        live: false,
        op: { kind: "move", wire, moving },
      };
      svg.setPointerCapture(ev.pointerId);
      return true;
    }

    const portEl = ev.target.closest('[data-sch="port"]');
    if (portEl) {
      const box = model.byName.get(portEl.getAttribute("data-id") ?? "");
      const pin = Number(portEl.getAttribute("data-pin"));
      const cavity = box?.pins[pin];
      // a cavity, or a box that has none and is joined to as a whole
      if (!box || (pin >= 0 ? !cavity : box.pins.length > 0)) return false;
      const right = portEl.getAttribute("data-x") !== "0";
      wireDrag = {
        pointerId: ev.pointerId,
        fixed: { x: right ? box.x + box.w : box.x, y: box.y + portOffset(box, pin) },
        sx: ev.clientX,
        sy: ev.clientY,
        live: false,
        op: { kind: "new", from: cavity ? `${box.id}.${cavity.cavity}` : box.id },
      };
      svg.setPointerCapture(ev.pointerId);
      return true;
    }
    return false;
  };

  /** Follows the wire in hand: the line, and whether the cavity under it would take it. */
  const moveWireDrag = (ev: PointerEvent, d: WireDrag): void => {
    if (!d.live) {
      if (
        Math.abs(ev.clientX - d.sx) < DRAG_THRESHOLD_PX &&
        Math.abs(ev.clientY - d.sy) < DRAG_THRESHOLD_PX
      ) {
        return;
      }
      d.live = true;
      focusWire(d.op.kind === "move" ? d.op.wire.id : null);
    }
    const at = schematic.screenToWorld(ev);
    const target: SchemTarget | null = targetAt(schematic.model(), at);
    let hot: { box: string; pin: number; ok: boolean } | null = null;
    if (target) {
      // asked of the drawing itself, on a copy, so the colour says what a drop would really do;
      // the answer only changes with the cavity, so it is asked once for each one the pointer enters
      const key = targetLabel(target);
      if (d.asked?.key !== key) d.asked = { key, ok: outcomeOf(d.op, key).ok };
      hot = { box: target.box.id, pin: target.pin, ok: d.asked.ok };
    }
    schematic.ghost = { from: d.fixed, to: at, hot };
    schematic.requestRedraw();
  };

  /** Drops the wire: on a cavity it is written into the tables, anywhere else it is let go. */
  const dropWire = (ev: PointerEvent, d: WireDrag): void => {
    clearGhost();
    if (!d.live) {
      // never moved: a click on the end of a wire is a click on the wire
      if (d.op.kind === "move") focusWire(d.op.wire.id);
      return;
    }
    const target = targetAt(schematic.model(), schematic.screenToWorld(ev));
    if (!target) return;
    const to = targetLabel(target);
    // let go on the cavity it started from: nothing was asked, so nothing is said
    if (d.op.kind === "new" && to === d.op.from) return;
    const op: WireOp =
      d.op.kind === "move"
        ? { kind: "move", ends: endsOf(d.op.wire), moving: d.op.moving }
        : { kind: "new", from: d.op.from };

    // the drawing is asked first, on a copy: a drop it would refuse is not worth a question
    const outcome = outcomeOf(d.op, to);
    const conflict = outcome.ok && opts.askDetails ? detailsConflict(store.doc, op, to) : null;
    if (!conflict) {
      commitWire(op, to);
      return;
    }
    void opts.askDetails?.(conflict).then((choice) => {
      if (choice) commitWire(op, to, choice);
    });
  };

  /** Writes the wire into the tables, and says what came of it. */
  const commitWire = (op: WireOp, to: string, choice?: Prefer | "splice"): void => {
    let outcome = { ok: false, reason: "no-end" } as RewireOutcome & { splice?: string };
    const prefer = choice === "splice" ? undefined : choice;
    store.edit((doc) => {
      if (choice === "splice") outcome = connectViaSplice(doc, op, to);
      else if (op.kind === "move") outcome = moveWireEnd(doc, op.ends, op.moving, to, prefer);
      else outcome = connectEnds(doc, op.from, to, prefer);
    }, "rewire");

    if (!outcome.ok) {
      if (outcome.reason === "unchanged") return;
      const other = outcome.reason === "occupied" ? outcome.other : "";
      opts.notify?.(t(`toast.rewire.${outcome.reason}`, { to, other }), "error");
      return;
    }
    const kept = op.kind === "move" ? op.ends[op.moving === 0 ? 1 : 0] : op.from;
    if (outcome.splice) {
      focusWire(null);
      opts.notify?.(t("toast.rewire.splice", { from: kept, to, splice: outcome.splice }), "info");
      return;
    }
    const made = schematic
      .model()
      .wires.find(
        (w) => (w.fromLabel === kept && w.toLabel === to) || (w.fromLabel === to && w.toLabel === kept),
      );
    focusWire(made?.id ?? null);
    opts.notify?.(
      t(op.kind === "move" ? "toast.rewire.moved" : "toast.rewire.made", { from: kept, to }),
      "info",
    );
  };

  const onPointerDown = (ev: PointerEvent): void => {
    if (ev.button !== 0 && ev.button !== 1) return;
    if (startWireDrag(ev)) return;
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
    if (wireDrag && wireDrag.pointerId === ev.pointerId) {
      moveWireDrag(ev, wireDrag);
      return;
    }
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
    if (wireDrag && wireDrag.pointerId === ev.pointerId) {
      const held = wireDrag;
      wireDrag = null;
      if (aborted) clearGhost();
      else dropWire(ev, held);
    }
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

  /**
   * Right click on a wire: what can be done to it is the colour, which is the
   * one thing about a wire this view can change. The colour lives in the cavity
   * table at each end, so that is where it is written.
   */
  const setColor = (wire: SchemWire, value: string): void => {
    let cells = 0;
    store.edit((doc) => {
      cells = setWireColor(doc, [wire.fromLabel, wire.toLabel], value);
    }, "wire-color");
    // the cells are counted whether or not they changed: picking the colour a wire has is not an error
    if (!cells && value) opts.notify?.(t("toast.wireColorNone"), "error");
  };

  /** Takes the wire out of the tables at both ends; one undo step. */
  const deleteWire = (wire: SchemWire): void => {
    let cleared = 0;
    store.edit((doc) => {
      cleared = disconnectWire(doc, endsOf(wire));
    }, "delete-wire");
    focusWire(null);
    if (!cleared) {
      opts.notify?.(t("toast.wireDeleteNone"), "error");
      return;
    }
    opts.notify?.(t("toast.wireDeleted", { from: wire.fromLabel, to: wire.toLabel }), "info");
  };

  const onContextMenu = (ev: MouseEvent): void => {
    const wireId = attrOf(ev.target, "wire");
    if (!wireId) return;
    const wire = schematic.model().wires.find((w) => w.id === wireId);
    if (!wire) return;
    ev.preventDefault();
    // the wire the menu is about stays lit, so it is clear which one it is
    store.select(null);
    focusWire(wire.id);
    openMenu(ev.clientX, ev.clientY, [
      { header: `${wire.fromLabel} → ${wire.toLabel}` },
      {
        label: t("menu.wireColor"),
        run: () => openColorPicker({ value: wire.color, onPick: (value) => setColor(wire, value) }),
      },
      { label: t("menu.wireColorClear"), disabled: wire.color.trim() === "", run: () => setColor(wire, "") },
      { separator: true },
      { label: t("menu.wireDelete"), shortcut: "Del", danger: true, run: () => deleteWire(wire) },
    ]);
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
    if (wireDrag) clearGhost();
    wireDrag = null;
  };
  // Escape puts a wire in hand back where it was
  // Delete takes out the wire in hand. A wire is not a selection, so the
  // sheet's own Delete has nothing to act on while one is picked; this does,
  // but only while the schematic is on screen and nobody is typing
  const onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.key === "Escape" && wireDrag) {
      cancelGestures();
      return;
    }
    if (ev.key !== "Delete" && ev.key !== "Backspace") return;
    const id = schematic.focusedWire;
    if (!id || ev.defaultPrevented || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (svg.getBoundingClientRect().width === 0) return;
    const field =
      ev.target instanceof HTMLElement
        ? ev.target.closest("input, textarea, select, [contenteditable]")
        : null;
    if (field) return;
    const wire = schematic.model().wires.find((w) => w.id === id);
    if (!wire) return;
    ev.preventDefault();
    deleteWire(wire);
  };

  svg.addEventListener("pointerdown", onPointerDown);
  svg.addEventListener("pointermove", onPointerMove);
  svg.addEventListener("pointerup", onPointerUp);
  svg.addEventListener("pointercancel", onPointerCancel);
  svg.addEventListener("contextmenu", onContextMenu);
  svg.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("blur", cancelGestures);
  window.addEventListener("keydown", onKeyDown);
  document.addEventListener("pointerup", onPointerUp);

  return () => {
    window.removeEventListener("keydown", onKeyDown);
    svg.removeEventListener("pointerdown", onPointerDown);
    svg.removeEventListener("pointermove", onPointerMove);
    svg.removeEventListener("pointerup", onPointerUp);
    svg.removeEventListener("pointercancel", onPointerCancel);
    svg.removeEventListener("contextmenu", onContextMenu);
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
