/**
 * Interaction on the drawing sheet.
 *
 * Everything goes through Pointer Events, so mouse, finger and pen follow the
 * same code path, and a two-finger pinch can be handled without a second set of
 * touch handlers. Drags use the store's beginLive/live/endLive so the whole
 * movement counts as one undo step, and redrawing is always deferred by the
 * renderer: never a synchronous draw per event.
 */
import type { RendererApi } from "@/app/context";
import {
  connectNodes,
  createJunction,
  deleteEntity,
  findInline,
  findNode,
  findSegment,
  findTable,
  nodeDegree,
  segmentEnds,
} from "@/core/doc";
import { clamp, projectT, snapTo } from "@/core/geometry";
import type { Store } from "@/core/store";
import type { EntityType, Point, Selection } from "@/core/types";
import { onLocaleChange } from "@/i18n";
import type { Translate } from "@/i18n";

/** Node snap radius, in screen pixels, converted through the zoom. */
const SNAP_RADIUS_PX = 14;
/** Below this threshold the movement counts as a click, not a drag. */
const DRAG_THRESHOLD_PX = 3;
/** Wheel lines and pages converted to pixels, for an even zoom step. */
const WHEEL_LINE_PX = 16;
const WHEEL_PAGE_PX = 400;

const ENTITY_TYPES: readonly string[] = ["node", "segment", "inline", "table"];

type DragKind = "node" | "table" | "inline";

interface DragState {
  pointerId: number;
  kind: DragKind;
  id: string;
  /** offset between pointer and element origin, in document coordinates */
  ox: number;
  oy: number;
  /** starting position on screen, for the drag threshold */
  sx: number;
  sy: number;
  /** true once the continuous edit has been started on the store */
  live: boolean;
}

interface PanState {
  pointerId: number;
  sx: number;
  sy: number;
  vx: number;
  vy: number;
}

interface PinchState {
  distance: number;
  mid: Point;
}

export function attachInteraction(opts: {
  store: Store;
  renderer: RendererApi;
  svg: SVGSVGElement;
  hint: HTMLElement;
  t: Translate;
  onContextMenu: (target: Selection | null, world: Point, ev: MouseEvent) => void;
  /** double click on the sheet: opens in-place editing for the element hit */
  onEdit?: (ev: MouseEvent) => void;
}): () => void {
  const { store, renderer, svg, hint, t } = opts;

  /** Active pointers in screen coordinates, used to recognize a pinch. */
  const pointers = new Map<number, Point>();
  /** The last click, so a double click can be spotted without relying on the DOM. */
  let lastClick = { time: 0, x: 0, y: 0 };
  let drag: DragState | null = null;
  let pan: PanState | null = null;
  let pinch: PinchState | null = null;

  /** Node the branch being drawn carries on from. */
  let branchPrev: string | null = null;
  /** Node born during this drawing session: if it stays isolated it goes on exit. */
  let branchNew: string | null = null;

  /* ---------------- utilità ---------------- */

  const snapRadius = (): number => SNAP_RADIUS_PX / (store.view.k || 1);
  const snap = (v: number): number => snapTo(v, store.snapEnabled);

  const selectionFromTarget = (target: EventTarget | null): Selection | null => {
    const el = target instanceof Element ? target.closest("[data-ent]") : null;
    const type = el?.getAttribute("data-ent") ?? "";
    const id = el?.getAttribute("data-id") ?? "";
    if (!id || !ENTITY_TYPES.includes(type)) return null;
    return { type: type as EntityType, id };
  };

  const setHover = (id: string | null): void => {
    if (renderer.hoverNodeId === id) return;
    renderer.hoverNodeId = id;
    renderer.requestRedraw();
  };

  const releaseCapture = (pointerId: number): void => {
    try {
      if (svg.hasPointerCapture(pointerId)) svg.releasePointerCapture(pointerId);
    } catch {
      // some browsers throw if the pointer was already released, which is harmless
    }
  };

  /** A node just placed and still unconnected: removing it loses nothing. */
  const isDisposableJunction = (id: string): boolean => {
    const n = findNode(store.doc, id);
    return !!n && n.kind === "junction" && !n.name && nodeDegree(store.doc, id) === 0;
  };

  /* ---------------- branch tool ---------------- */

  /**
   * Entering the branch tool resumes from the selected node, which is how the
   * right-click menu starts drawing ("start a branch here") without needing an
   * API of its own. An isolated, unnamed node is almost always the one the menu
   * just created, so it counts as removable.
   */
  const startBranch = (): void => {
    const sel = store.selection;
    branchPrev = sel && sel.type === "node" && findNode(store.doc, sel.id) ? sel.id : null;
    branchNew = branchPrev && isDisposableJunction(branchPrev) ? branchPrev : null;
    renderer.branchPreviewTo = null;
  };

  const finishBranch = (): void => {
    const orphan = branchPrev;
    branchPrev = null;
    renderer.branchPreviewTo = null;
    if (orphan && orphan === branchNew && isDisposableJunction(orphan)) {
      const sel = store.selection;
      if (sel && sel.type === "node" && sel.id === orphan) store.select(null);
      store.edit((doc) => deleteEntity(doc, "node", orphan), "branch-cancel");
    }
    branchNew = null;
  };

  /** One click of the branch tool: snaps to or creates a node and links it to the previous one. */
  const branchStep = (world: Point): void => {
    const nearId = renderer.nodeNear(world, snapRadius());
    let targetId = nearId;
    store.edit((doc) => {
      if (!targetId) {
        const created = createJunction(doc, snap(world.x), snap(world.y));
        targetId = created.id;
        branchNew = created.id;
      } else if (targetId !== branchPrev) {
        branchNew = null;
      }
      if (branchPrev && branchPrev !== targetId) connectNodes(doc, branchPrev, targetId);
    }, "branch");
    if (!targetId) return;
    branchPrev = targetId;
    renderer.branchPreviewTo = world;
    store.select({ type: "node", id: targetId });
    renderer.requestRedraw();
  };

  /* ---------------- gesti ---------------- */

  const cancelGestures = (): void => {
    if (drag) {
      if (drag.live) store.cancelLive();
      releaseCapture(drag.pointerId);
      drag = null;
    }
    if (pan) {
      releaseCapture(pan.pointerId);
      pan = null;
    }
    pinch = null;
    pointers.clear();
  };

  const pinchGeometry = (): PinchState | null => {
    const [a, b] = Array.from(pointers.values());
    if (!a || !b) return null;
    return {
      distance: Math.hypot(a.x - b.x, a.y - b.y),
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  };

  /** A second finger cancels the gesture in progress and switches to zoom plus pan. */
  const beginPinch = (): void => {
    if (drag) {
      if (drag.live) store.endLive("move");
      releaseCapture(drag.pointerId);
      drag = null;
    }
    if (pan) {
      releaseCapture(pan.pointerId);
      pan = null;
    }
    pinch = pinchGeometry();
  };

  const updatePinch = (): void => {
    const next = pinchGeometry();
    if (!pinch || !next) return;
    if (pinch.distance > 0 && next.distance > 0) {
      renderer.zoomBy(next.distance / pinch.distance, next.mid);
    }
    const view = store.view;
    store.setView({
      x: view.x + (next.mid.x - pinch.mid.x),
      y: view.y + (next.mid.y - pinch.mid.y),
      k: view.k,
    });
    pinch = next;
  };

  /* ---------------- gestori ---------------- */

  const onPointerDown = (ev: PointerEvent): void => {
    if (ev.button === 2) return; // il tasto destro è servito dall'evento contextmenu

    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pointers.size >= 2) {
      beginPinch();
      return;
    }

    // an edit in progress is closed before acting on the sheet
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) active.blur();

    // The double click is recognized here rather than through the browser's
    // `dblclick`: the sheet is redrawn between the two clicks, so `dblclick`
    // bubbles to the SVG and loses the element that was hit. The first
    // `pointerdown`, by contrast, still has the real element under it.
    const now = ev.timeStamp;
    const isSecondClick =
      ev.button === 0 &&
      now - lastClick.time < 400 &&
      Math.abs(ev.clientX - lastClick.x) < 6 &&
      Math.abs(ev.clientY - lastClick.y) < 6;
    lastClick = { time: now, x: ev.clientX, y: ev.clientY };
    if (isSecondClick && store.tool === "select") {
      lastClick.time = 0; // un terzo clic non riapre l'editor
      opts.onEdit?.(ev);
      return;
    }

    const world = renderer.screenToWorld(ev);
    const middleOrAlt = ev.button === 1 || (ev.button === 0 && ev.altKey);
    if (middleOrAlt) {
      ev.preventDefault(); // sopprime lo scorrimento automatico del tasto centrale
      pan = { pointerId: ev.pointerId, sx: ev.clientX, sy: ev.clientY, vx: store.view.x, vy: store.view.y };
      svg.setPointerCapture(ev.pointerId);
      return;
    }
    if (ev.button !== 0) return;

    if (store.tool === "branch") {
      branchStep(world);
      return;
    }

    const target = selectionFromTarget(ev.target);
    if (!target) {
      store.select(null);
      pan = { pointerId: ev.pointerId, sx: ev.clientX, sy: ev.clientY, vx: store.view.x, vy: store.view.y };
      svg.setPointerCapture(ev.pointerId);
      return;
    }

    // Ctrl gathers several nodes for the actions that need more than one, and
    // starts no drag: dragging a group would be a different feature, and doing
    // it by accident while collecting the group is worse than not having it.
    if (ev.ctrlKey || ev.metaKey) {
      store.toggle(target);
      return;
    }

    store.select(target);
    const base = { pointerId: ev.pointerId, id: target.id, sx: ev.clientX, sy: ev.clientY, live: false };
    if (target.type === "node") {
      const n = findNode(store.doc, target.id);
      if (n) drag = { ...base, kind: "node", ox: world.x - n.x, oy: world.y - n.y };
    } else if (target.type === "table") {
      const tb = findTable(store.doc, target.id);
      if (tb) drag = { ...base, kind: "table", ox: world.x - tb.x, oy: world.y - tb.y };
    } else if (target.type === "inline") {
      drag = { ...base, kind: "inline", ox: 0, oy: 0 };
    }
    if (drag) svg.setPointerCapture(ev.pointerId);
  };

  const applyDrag = (state: DragState, ev: PointerEvent, world: Point): void => {
    if (!state.live) {
      if (
        Math.abs(ev.clientX - state.sx) < DRAG_THRESHOLD_PX &&
        Math.abs(ev.clientY - state.sy) < DRAG_THRESHOLD_PX
      ) {
        return;
      }
      store.beginLive();
      state.live = true;
    }
    store.live((doc) => {
      if (state.kind === "node") {
        const n = findNode(doc, state.id);
        if (!n) return;
        n.x = snap(world.x - state.ox);
        n.y = snap(world.y - state.oy);
      } else if (state.kind === "table") {
        const tb = findTable(doc, state.id);
        if (!tb) return;
        tb.x = snap(world.x - state.ox);
        tb.y = snap(world.y - state.oy);
      } else {
        const inline = findInline(doc, state.id);
        const seg = inline ? findSegment(doc, inline.seg) : undefined;
        const ends = seg ? segmentEnds(doc, seg) : null;
        if (!inline || !ends) return;
        inline.t = projectT(ends[0], ends[1], world);
      }
    }, "move");
  };

  const updateHover = (ev: PointerEvent, world: Point): void => {
    if (store.tool === "branch") {
      setHover(renderer.nodeNear(world, snapRadius()));
      if (branchPrev) {
        renderer.branchPreviewTo = world;
        renderer.requestRedraw();
      }
      return;
    }
    const el = ev.target instanceof Element ? ev.target.closest('[data-ent="node"]') : null;
    setHover(el?.getAttribute("data-id") ?? null);
  };

  const onPointerMove = (ev: PointerEvent): void => {
    const tracked = pointers.get(ev.pointerId);
    if (tracked) {
      tracked.x = ev.clientX;
      tracked.y = ev.clientY;
    }
    if (pinch) {
      updatePinch();
      return;
    }
    if (pan) {
      if (ev.pointerId !== pan.pointerId) return;
      store.setView({
        x: pan.vx + (ev.clientX - pan.sx),
        y: pan.vy + (ev.clientY - pan.sy),
        k: store.view.k,
      });
      return;
    }
    const world = renderer.screenToWorld(ev);
    if (drag) {
      if (ev.pointerId !== drag.pointerId) return;
      applyDrag(drag, ev, world);
      return;
    }
    updateHover(ev, world);
  };

  const endPointer = (ev: PointerEvent, aborted: boolean): void => {
    pointers.delete(ev.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pan && pan.pointerId === ev.pointerId) pan = null;
    if (drag && drag.pointerId === ev.pointerId) {
      if (drag.live) {
        if (aborted) store.cancelLive();
        else store.endLive("move");
      }
      drag = null;
    }
    releaseCapture(ev.pointerId);
  };

  const onPointerUp = (ev: PointerEvent): void => endPointer(ev, false);
  const onPointerCancel = (ev: PointerEvent): void => endPointer(ev, true);

  const onPointerLeave = (): void => {
    if (drag || pan || pinch) return;
    setHover(null);
    if (renderer.branchPreviewTo) {
      renderer.branchPreviewTo = null; // niente anteprima appesa fuori dal foglio
      renderer.requestRedraw();
    }
  };

  const onWheel = (ev: WheelEvent): void => {
    ev.preventDefault();
    const unit = ev.deltaMode === 1 ? WHEEL_LINE_PX : ev.deltaMode === 2 ? WHEEL_PAGE_PX : 1;
    const factor = clamp(Math.pow(1.0015, -ev.deltaY * unit), 0.2, 5);
    renderer.zoomBy(factor, { x: ev.clientX, y: ev.clientY });
  };

  const onDoubleClick = (ev: MouseEvent): void => {
    if (store.tool === "branch") {
      store.setTool("select");
      return;
    }
    // the double click is how editing happens straight on the sheet
    opts.onEdit?.(ev);
  };

  const onContextMenu = (ev: MouseEvent): void => {
    ev.preventDefault();
    if (store.tool === "branch") {
      store.setTool("select"); // il tasto destro chiude il disegno del ramo
      return;
    }
    const world = renderer.screenToWorld(ev);
    let target = selectionFromTarget(ev.target);
    if (!target || target.type === "segment") {
      // many elements sit along a branch: a nearby node is the one that was meant
      const nearId = renderer.nodeNear(world, snapRadius());
      if (nearId) target = { type: "node", id: nearId };
    }
    // right-clicking inside a group keeps the group: the menu is being opened
    // to act on it, and collapsing it to one element would undo the gathering
    // the user just did
    if (target && !store.isSelected(target)) store.select(target);
    opts.onContextMenu(target, world, ev);
  };

  const onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.key !== "Escape" || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (store.tool === "branch") store.setTool("select");
  };

  /* ---------------- strumento e suggerimento ---------------- */

  const syncTool = (): void => {
    const branching = store.tool === "branch";
    svg.classList.toggle("is-drawing", branching);
    hint.textContent = t(branching ? "hint.branch" : "hint.select");
  };

  const offTool = store.on("tool", ({ tool }) => {
    if (tool === "branch") startBranch();
    else finishBranch();
    syncTool();
    renderer.requestRedraw();
  });

  const offLoad = store.on("load", () => {
    branchPrev = null;
    branchNew = null;
    renderer.branchPreviewTo = null;
    setHover(null);
    cancelGestures();
  });

  const offLocale = onLocaleChange(syncTool);

  /* ---------------- collegamento ---------------- */

  svg.addEventListener("pointerdown", onPointerDown);
  svg.addEventListener("pointermove", onPointerMove);
  svg.addEventListener("pointerup", onPointerUp);
  svg.addEventListener("pointercancel", onPointerCancel);
  svg.addEventListener("pointerleave", onPointerLeave);
  svg.addEventListener("wheel", onWheel, { passive: false });
  svg.addEventListener("dblclick", onDoubleClick);
  svg.addEventListener("contextmenu", onContextMenu);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("blur", cancelGestures);
  // capture is released during a pinch, so if a finger lifts outside the sheet
  // the event would never reach the SVG and the gesture would stay open
  document.addEventListener("pointerup", onPointerUp);
  document.addEventListener("pointercancel", onPointerCancel);

  if (store.tool === "branch") startBranch();
  syncTool();

  return () => {
    svg.removeEventListener("pointerdown", onPointerDown);
    svg.removeEventListener("pointermove", onPointerMove);
    svg.removeEventListener("pointerup", onPointerUp);
    svg.removeEventListener("pointercancel", onPointerCancel);
    svg.removeEventListener("pointerleave", onPointerLeave);
    svg.removeEventListener("wheel", onWheel);
    svg.removeEventListener("dblclick", onDoubleClick);
    svg.removeEventListener("contextmenu", onContextMenu);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("blur", cancelGestures);
    document.removeEventListener("pointerup", onPointerUp);
    document.removeEventListener("pointercancel", onPointerCancel);
    offTool();
    offLoad();
    offLocale();
    cancelGestures();
  };
}
