/**
 * Drawing of the schematic view.
 *
 * The same engine idea as the formboard renderer: everything is redrawn from
 * the model, draws are coalesced onto a frame, and no state is kept anywhere
 * but in the document. What differs is that this view has a viewport of its
 * own — in the side-by-side mode the two views are panned and zoomed
 * separately, because they are two readings of the harness and not two windows
 * onto one sheet.
 *
 * The model itself is rebuilt only when the document changes: routing every
 * wire costs a walk of the harness graph, and a pan must not pay for it.
 */
import { colorsOf } from "@/core/colors";
import {
  buildSchematic,
  boardHighlight,
  schematicHighlight,
  HEAD_H,
  PIN_H,
  pinOffset,
  portOffset,
} from "@/core/schematic";
import type { Schematic, SchemBox, SchemJoint, SchemWire } from "@/core/schematic";
import { clamp } from "@/core/geometry";
import type { Store } from "@/core/store";
import type { Point, Rect, Viewport } from "@/core/types";
import type { Translate } from "@/i18n";
import { palette, wireHalo } from "./palette";
import { sameView } from "./renderer";
import { el, ellipsize, text, textWidth } from "./svg";
import { filletedPath } from "./wires";

/**
 * A schematic spreads its boxes out to keep the wires apart, so it is wider
 * than the sheet it comes from — often much wider than half a screen. The floor
 * has to be low enough for a whole one to be fitted into the side-by-side view,
 * or the fit stops at the floor and quietly leaves a connector off the edge.
 */
const MIN_ZOOM = 0.08;
const MAX_ZOOM = 3;
const FIT_ZOOM = 1.4;
/**
 * Radius the wires turn their corners on.
 *
 * Asked for generously and cut down where it does not fit: a corner is rounded
 * by at most half of the shorter run meeting at it, so a wire with room turns
 * in a wide arc and one stepping between two lanes a hair apart still turns as
 * roundly as that hair allows. Nothing has to be worked out per corner — the
 * path builder already holds a radius to what the geometry can take.
 */
const CORNER_R = 22;
const WIRE_W = 2;
const WIRE_HIT = 12;
/** Radius of the handle on the end of a wire: small, because it sits on the edge of a box that is also dragged. */
const END_GRAB = 5;
/** Colour of a wire whose cell names nothing that can be recognized. */
const UNKNOWN_WIRE = "#9aa3ad";
/** Size of the colour swatch at the end of a cavity row. */
const SWATCH_W = 20;
const SWATCH_H = 9;
/** The arrow that marks a mated pair: how long its heads are, and how far off
 *  the two boxes it starts, so a head is never drawn against a border. */
const JOINT_ARROW = 7;
const JOINT_GAP = 5;
/**
 * How far inside a splice the wires reaching it converge.
 *
 * Room enough for the curve that takes them there: they come in spread across
 * the face of the box and leave as one line, and the turn between the two is
 * the whole of what says they are joined.
 */
const SPLICE_INSET = 32;

export interface SchematicOptions {
  store: Store;
  t: Translate;
  svg: SVGSVGElement;
  world: SVGGElement;
  zoomLabel?: HTMLElement | null;
}

/**
 * A wire being dragged by one end: the line from the end that stays to the
 * pointer, and the cavity it would land on. It is drawn over the schematic and
 * is not part of the document until it is dropped.
 */
export interface SchemGhost {
  from: Point;
  to: Point;
  /** what is under the pointer; `ok` says whether the wire may land there */
  hot: { box: string; pin: number; ok: boolean } | null;
}

/** Where a wire ends on a box, and which end of which wire it is. */
interface EndDot {
  at: Point;
  wire: string;
  end: 0 | 1;
}

export class SchematicRenderer {
  /** Wire picked in this view: it is not a document element, so it lives here. */
  focusedWire: string | null = null;
  /** The wire being dragged, if one is. */
  ghost: SchemGhost | null = null;

  private readonly store: Store;
  private readonly t: Translate;
  private readonly svg: SVGSVGElement;
  private readonly world: SVGGElement;
  private readonly zoomLabel: HTMLElement | null;

  private view = { x: 0, y: 0, k: 1 };
  private frame: number | null = null;
  private cached: Schematic | null = null;
  /** Size of the view at the last draw, to keep the middle where it was. */
  private size = { w: 0, h: 0 };
  /** What the last fit produced, to tell a chosen view from an offered one. */
  private fittedView: Viewport | null = null;

  constructor(opts: SchematicOptions) {
    this.store = opts.store;
    this.t = opts.t;
    this.svg = opts.svg;
    this.world = opts.world;
    this.zoomLabel = opts.zoomLabel ?? null;
  }

  /* ---------------- model ---------------- */

  /** The document changed: the model has to be built again before the next draw. */
  invalidate(): void {
    this.cached = null;
  }

  model(): Schematic {
    if (!this.cached) this.cached = buildSchematic(this.store.doc);
    return this.cached;
  }

  /** Everything lit on the formboard by what is picked here. */
  boardHighlight(): { nodes: Set<string>; segments: Set<string> } {
    return boardHighlight(this.model(), this.focusedWire);
  }

  /* ---------------- draw cycle ---------------- */

  requestRedraw(): void {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.draw();
    });
  }

  /**
   * Holds the middle of the view still when the view itself changes size.
   *
   * Half the screen and the whole screen are both ordinary states here, so
   * going from one to the other must not leave the schematic hanging off an
   * edge. One nobody has touched since it was fitted is fitted again to the
   * size it now has; one somebody panned or zoomed keeps what was in the middle
   * and the scale they picked, which is what happens when you make a window
   * wider on any other program.
   */
  private keepCentre(): void {
    const rect = this.svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dx = (rect.width - this.size.w) / 2;
    const dy = (rect.height - this.size.h) / 2;
    const known = this.size.w > 0;
    this.size = { w: rect.width, h: rect.height };
    if (!known || (!dx && !dy)) return;
    if (this.fittedView && sameView(this.view, this.fittedView)) {
      this.fitView();
      return;
    }
    this.view = { ...this.view, x: this.view.x + dx, y: this.view.y + dy };
  }

  private draw(): void {
    this.keepCentre();
    const model = this.model();
    const world = this.world;
    world.replaceChildren();
    world.setAttribute("transform", `translate(${this.view.x},${this.view.y}) scale(${this.view.k})`);

    if (this.zoomLabel) {
      this.zoomLabel.textContent = this.t("canvas.zoom", { percent: Math.round(this.view.k * 100) });
    }

    if (!model.boxes.length) {
      // in the middle of the box an empty model reports, so fitting the view
      // puts the sentence where the drawing would have been
      const box = model.bbox;
      text(
        box.x + box.w / 2,
        box.y + box.h / 2,
        this.t("schematic.empty"),
        { "font-size": 15, fill: palette().textDim, "text-anchor": "middle" },
        world,
      );
      return;
    }

    const lit = schematicHighlight(model, this.store.selection, this.store.doc);
    if (this.focusedWire) lit.wires.add(this.focusedWire);
    const focused = lit.wires.size > 0 || lit.boxes.size > 0;

    const gWires = el("g", {}, world);
    const gBoxes = el("g", {}, world);
    const gTop = el("g", { "pointer-events": "none" }, world);

    // where the wires really land, gathered once: a dot is drawn from the line
    // itself, so it can never sit at a port nothing arrives at
    const ends = new Map<string, EndDot[]>();
    /** the cavities with a wire on them: the others are where a new one can start */
    const wired = new Set<string>();
    const land = (name: string, pin: number, dot: EndDot | undefined): void => {
      wired.add(`${name}:${pin}`);
      if (!dot) return;
      const list = ends.get(name);
      if (list) list.push(dot);
      else ends.set(name, [dot]);
    };
    const endOf = (wire: SchemWire, end: 0 | 1): EndDot | undefined => {
      const at = wire.points[end === 0 ? 0 : wire.points.length - 1];
      return at ? { at, wire: wire.id, end } : undefined;
    };

    for (const wire of model.wires) {
      this.drawWire(wire, gWires, focused && !lit.wires.has(wire.id));
      land(wire.from.box, wire.from.pin, endOf(wire, 0));
      land(wire.to.box, wire.to.pin, endOf(wire, 1));
    }
    for (const box of model.boxes) {
      this.drawBox(box, ends.get(box.id) ?? [], gBoxes, lit.boxes.has(box.id), wired);
    }
    for (const joint of model.joints) {
      this.drawJoint(joint, gTop, lit.boxes.has(joint.a) || lit.boxes.has(joint.b));
    }
    // a lit wire is drawn a second time over the boxes: what is being followed
    // must not disappear behind the connectors it passes
    for (const wire of model.wires) {
      if (lit.wires.has(wire.id)) this.drawWire(wire, gTop, false, true);
    }
    if (this.ghost) this.drawGhost(this.ghost, model, gTop);
  }

  /** The wire in hand, and the cavity it is over. */
  private drawGhost(ghost: SchemGhost, model: Schematic, parent: SVGGElement): void {
    const accent = palette().selection;
    const box = ghost.hot ? model.byName.get(ghost.hot.box) : undefined;
    if (ghost.hot && box) {
      const whole = ghost.hot.pin < 0;
      const colour = ghost.hot.ok ? accent : palette().errorStroke;
      el(
        "rect",
        {
          x: box.x,
          y: whole ? box.y : box.y + HEAD_H + ghost.hot.pin * PIN_H,
          width: box.w,
          height: whole ? box.h : PIN_H,
          rx: whole ? 7 : 3,
          fill: colour,
          "fill-opacity": 0.18,
          stroke: colour,
          "stroke-width": 1.6,
        },
        parent,
      );
    }
    el(
      "line",
      {
        x1: ghost.from.x,
        y1: ghost.from.y,
        x2: ghost.to.x,
        y2: ghost.to.y,
        stroke: ghost.hot && !ghost.hot.ok ? palette().errorStroke : accent,
        "stroke-width": 2.2,
        "stroke-dasharray": "6 4",
        "stroke-linecap": "round",
      },
      parent,
    );
    el("circle", { cx: ghost.to.x, cy: ghost.to.y, r: 4.5, fill: accent }, parent);
  }

  /* ---------------- boxes ---------------- */

  private drawBox(
    box: SchemBox,
    ends: readonly EndDot[],
    parent: SVGGElement,
    lit: boolean,
    wired: ReadonlySet<string>,
  ): void {
    const g = el(
      "g",
      {
        transform: `translate(${box.x},${box.y})`,
        "data-sch": "box",
        "data-id": box.id,
        style: "cursor:move",
      },
      parent,
    );

    el(
      "rect",
      {
        x: 0,
        y: 0,
        width: box.w,
        height: box.h,
        rx: 7,
        fill: palette().tableBg,
        stroke: lit ? palette().selection : palette().tableBorder,
        "stroke-width": lit ? 2.2 : 1.2,
        ...(box.unknown ? { "stroke-dasharray": "5 3" } : {}),
      },
      g,
    );
    el(
      "path",
      {
        d: `M0,7 A7,7 0 0 1 7,0 L${box.w - 7},0 A7,7 0 0 1 ${box.w},7 L${box.w},${HEAD_H} L0,${HEAD_H} Z`,
        fill: palette().tableTitleBg,
        stroke: "none",
      },
      g,
    );
    el(
      "line",
      { x1: 0, y1: HEAD_H, x2: box.w, y2: HEAD_H, stroke: palette().tableBorder, "stroke-width": 1 },
      g,
    );
    // the box is sized for its title, so this only ever has to shorten one that
    // the estimate the layout works in could not quite measure
    text(
      box.w / 2,
      HEAD_H - 8,
      ellipsize(box.title, 12.5, box.w - 14, true),
      { "font-size": 12.5, "font-weight": 700, "text-anchor": "middle", fill: palette().text },
      g,
    );

    box.pins.forEach((pin, index) => {
      const y = pinOffset(index);
      if (index) {
        el(
          "line",
          {
            x1: 6,
            y1: y - PIN_H / 2,
            x2: box.w - 6,
            y2: y - PIN_H / 2,
            stroke: palette().tableLine,
            "stroke-width": 0.7,
            opacity: 0.7,
          },
          g,
        );
      }
      const row = el("g", { "data-sch": "pin", "data-id": box.id, "data-pin": index }, g);
      const cavityW = Math.max(12, textWidth(pin.cavity, 10.5, true));
      text(7, y + 3.6, pin.cavity, { "font-size": 10.5, "font-weight": 700, fill: palette().textDim }, row);
      const labelX = 11 + cavityW;
      const room = box.w - labelX - SWATCH_W - 12;
      if (room > 10 && pin.label) {
        text(labelX, y + 3.6, ellipsize(pin.label, 11, room), { "font-size": 11, fill: palette().text }, row);
      }
      this.drawSwatch(pin.color, box.w - SWATCH_W - 6, y - SWATCH_H / 2, row);

      // a cavity with no wire shows where one could be started when the pointer
      // is over its box; the two sides, because the wire may leave by either
      if (wired.has(`${box.id}:${index}`)) return;
      for (const x of [0, box.w]) {
        el(
          "circle",
          {
            class: "sch-port",
            cx: x,
            cy: y,
            r: 4.5,
            fill: palette().tableBg,
            stroke: palette().selection,
            "stroke-width": 1.6,
            "data-sch": "port",
            "data-id": box.id,
            "data-pin": index,
            "data-x": x,
            style: "cursor:crosshair",
          },
          g,
        );
      }
    });

    this.drawSplice(
      box,
      ends.map((e) => e.at),
      g,
    );
    // a box with no cavities is one electrical point, and a wire can start from
    // it on either side; the handles of the wires already on it are drawn after
    // these, so they win where the two meet
    if (!box.pins.length) {
      const y = portOffset(box, -1);
      for (const x of [0, box.w]) {
        el(
          "circle",
          {
            class: "sch-port",
            cx: x,
            cy: y,
            r: 4.5,
            fill: palette().tableBg,
            stroke: palette().selection,
            "stroke-width": 1.6,
            "data-sch": "port",
            "data-id": box.id,
            "data-pin": -1,
            "data-x": x,
            style: "cursor:crosshair",
          },
          g,
        );
      }
    }
    for (const end of ends) {
      const cx = end.at.x - box.x;
      const cy = end.at.y - box.y;
      el("circle", { cx, cy, r: 3, fill: palette().tableBorder, "pointer-events": "none" }, g);
      // the end of a wire is a handle: picked up, it moves the wire to another cavity
      el(
        "circle",
        {
          cx,
          cy,
          r: END_GRAB,
          fill: "transparent",
          "data-sch": "end",
          "data-wire": end.wire,
          "data-end": end.end,
          style: "cursor:grab",
        },
        g,
      );
    }
  }

  /**
   * What a splice or a ring terminal does to the wires that reach it: joins
   * them.
   *
   * A box with no cavities is one electrical point, and every wire arriving at
   * it is the same point. Drawn as a plain rectangle with lines stopping at its
   * edge, that is exactly what it does not say — it looks like a connector
   * whose pin-out somebody forgot to fill in. So the wires are taken inside and
   * brought onto a bar: the mark a schematic has always used for a splice, and
   * the reason the two sides are drawn joined right through the middle.
   */
  private drawSplice(box: SchemBox, ends: readonly Point[], parent: SVGGElement): void {
    if (box.pins.length || ends.length < 2) return;
    // Where the wires really arrive, which is not the middle of the box: the
    // header takes the top of it. A bar drawn down the middle of the box ends
    // in mid-air a few units above everything it is supposed to be joining.
    const centre = portOffset(box, -1);
    // the same weight as the wires it is joining: this is those wires carrying
    // on inside the connector, not a busbar they are bolted to
    const join = {
      fill: "none",
      stroke: palette().text,
      "stroke-width": WIRE_W,
      "stroke-linecap": "round",
      "pointer-events": "none",
    } as const;

    const sides = [
      { at: SPLICE_INSET, edge: 0, ys: [] as number[] },
      { at: box.w - SPLICE_INSET, edge: box.w, ys: [] as number[] },
    ];
    for (const end of ends) {
      const side = end.x < box.x + box.w / 2 ? sides[0]! : sides[1]!;
      side.ys.push(end.y - box.y);
    }
    const used = sides.filter((side) => side.ys.length);

    for (const side of used) {
      // each wire sweeps in from where it arrived to the one point they share,
      // the curve taking the whole of the run rather than turning a corner on it
      const reach = (side.at - side.edge) * 0.55;
      for (const y of side.ys) {
        el(
          "path",
          {
            ...join,
            d:
              `M${side.edge},${y} ` +
              `C${side.edge + reach},${y} ${side.at - reach},${centre} ${side.at},${centre}`,
          },
          parent,
        );
      }
      // and a dot where they meet, which is the mark for a junction — only
      // where something really does meet, never on a wire passing through
      if (side.ys.length > 1) {
        el(
          "circle",
          { cx: side.at, cy: centre, r: WIRE_W * 1.4, fill: palette().text, "pointer-events": "none" },
          parent,
        );
      }
    }
    if (used.length === 2) {
      el("path", { ...join, d: `M${used[0]!.at},${centre} L${used[1]!.at},${centre}` }, parent);
    }
  }

  /** The colour of a wire, as bands, the way the cavity tables draw it. */
  private drawSwatch(value: string, x: number, y: number, parent: SVGGElement): void {
    const bands = colorsOf(value);
    if (!bands) {
      if (!value) return;
      text(
        x + SWATCH_W,
        y + SWATCH_H - 1,
        ellipsize(value, 9, SWATCH_W + 8),
        { "font-size": 9, "text-anchor": "end", fill: palette().textDim },
        parent,
      );
      return;
    }
    const w = SWATCH_W / bands.length;
    bands.forEach((hex, i) => {
      el(
        "rect",
        { x: x + i * w, y, width: w, height: SWATCH_H, fill: hex, "pointer-events": "none" },
        parent,
      );
    });
    el(
      "rect",
      {
        x,
        y,
        width: SWATCH_W,
        height: SWATCH_H,
        rx: 1.5,
        fill: "none",
        stroke: palette().swatchBorder,
        "stroke-width": 0.8,
        "pointer-events": "none",
      },
      parent,
    );
  }

  /* ---------------- joints ---------------- */

  /**
   * A mated pair, drawn as one arrow with a head at each end.
   *
   * The same mark the sheet uses, for the same reason: neither of the two is
   * the source, they plug into each other. It is deliberately not a wire —
   * plain, thin, and in the colour of the writing rather than of a conductor —
   * because nothing is cut to this length and no circuit runs *along* it.
   */
  private drawJoint(joint: SchemJoint, parent: SVGGElement, lit: boolean): void {
    const dx = joint.to.x - joint.from.x;
    const dy = joint.to.y - joint.from.y;
    const span = Math.hypot(dx, dy);
    if (span < JOINT_GAP * 2 + 4) return; // nose to nose: the pairing is plain to see
    const ux = dx / span;
    const uy = dy / span;
    const line = {
      stroke: lit ? palette().selection : palette().textDim,
      "stroke-width": lit ? 2 : 1.5,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      fill: "none",
      "pointer-events": "none",
    };

    const a = { x: joint.from.x + ux * JOINT_GAP, y: joint.from.y + uy * JOINT_GAP };
    const b = { x: joint.to.x - ux * JOINT_GAP, y: joint.to.y - uy * JOINT_GAP };
    el("path", { ...line, d: `M${a.x},${a.y} L${b.x},${b.y}` }, parent);

    // a head at each end, pointing into the connector it belongs to
    for (const [at, dir] of [
      [a, -1],
      [b, 1],
    ] as const) {
      const back = { x: at.x - ux * dir * JOINT_ARROW, y: at.y - uy * dir * JOINT_ARROW };
      const wing = JOINT_ARROW * 0.5;
      el(
        "path",
        {
          ...line,
          d:
            `M${back.x - uy * wing},${back.y + ux * wing} L${at.x},${at.y} ` +
            `L${back.x + uy * wing},${back.y - ux * wing}`,
        },
        parent,
      );
    }
  }

  /* ---------------- wires ---------------- */

  private drawWire(wire: SchemWire, parent: SVGGElement, dimmed: boolean, lit = false): void {
    if (wire.points.length < 2) return;
    const d = filletedPath(wire.points, CORNER_R);
    const bands = wire.bands ?? [];
    const base = bands[0] ?? UNKNOWN_WIRE;
    const shape = { d, fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" };

    if (lit) {
      el(
        "path",
        { ...shape, stroke: palette().selection, "stroke-width": WIRE_W + 5, opacity: 0.45 },
        parent,
      );
    }
    // a black wire on the dark sheet is outlined, or it cannot be followed
    const halo = wireHalo(base);
    if (halo) {
      el(
        "path",
        {
          ...shape,
          stroke: halo,
          "stroke-width": WIRE_W + 2.6,
          opacity: dimmed ? 0.12 : 0.85,
          "pointer-events": "none",
        },
        parent,
      );
    }
    el(
      "path",
      {
        ...shape,
        stroke: base,
        "stroke-width": WIRE_W,
        opacity: dimmed ? 0.18 : 1,
        ...(wire.unreachable ? { "stroke-dasharray": "7 5" } : {}),
        "pointer-events": "none",
      },
      parent,
    );
    // a banded wire carries its tracer along it, the same reading as on the sheet
    if (bands.length > 1) {
      el(
        "path",
        {
          ...shape,
          stroke: bands[1]!,
          "stroke-width": WIRE_W,
          "stroke-dasharray": "4 7",
          opacity: dimmed ? 0.18 : 1,
          "pointer-events": "none",
        },
        parent,
      );
    }
    if (lit) return;
    el(
      "path",
      {
        ...shape,
        stroke: "transparent",
        "stroke-width": WIRE_HIT,
        "data-sch": "wire",
        "data-id": wire.id,
        style: "cursor:pointer",
      },
      parent,
    );
  }

  /* ---------------- view ---------------- */

  fitView(): void {
    const box = this.model().bbox;
    const rect = this.svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return; // hidden view: nothing to fit to yet
    const raw = Math.min(rect.width / box.w, rect.height / box.h);
    const k = Number.isFinite(raw) && raw > 0 ? clamp(raw, MIN_ZOOM, FIT_ZOOM) : 1;
    // fitted to this size: the next draw has nothing left to make up for
    this.size = { w: rect.width, h: rect.height };
    this.view = {
      k,
      x: (rect.width - box.w * k) / 2 - box.x * k,
      y: (rect.height - box.h * k) / 2 - box.y * k,
    };
    this.fittedView = { ...this.view };
    this.requestRedraw();
  }

  centerOn(rect: Rect): void {
    const area = this.svg.getBoundingClientRect();
    if (!area.width) return;
    this.view = {
      k: this.view.k,
      x: area.width / 2 - (rect.x + rect.w / 2) * this.view.k,
      y: area.height / 2 - (rect.y + rect.h / 2) * this.view.k,
    };
    this.requestRedraw();
  }

  /** Brings the box of a connector into the middle of this view. */
  centerOnBox(name: string): boolean {
    const box = this.model().byName.get(name);
    if (!box) return false;
    this.centerOn({ x: box.x, y: box.y, w: box.w, h: box.h });
    return true;
  }

  setPan(x: number, y: number): void {
    this.view = { ...this.view, x, y };
    this.requestRedraw();
  }

  pan(): Point {
    return { x: this.view.x, y: this.view.y };
  }

  zoomBy(factor: number, pivotScreen?: Point): void {
    const k = clamp(this.view.k * factor, MIN_ZOOM, MAX_ZOOM);
    if (k === this.view.k) return;
    const rect = this.svg.getBoundingClientRect();
    const px = pivotScreen ? pivotScreen.x - rect.left : rect.width / 2;
    const py = pivotScreen ? pivotScreen.y - rect.top : rect.height / 2;
    this.view = {
      k,
      x: px - ((px - this.view.x) * k) / this.view.k,
      y: py - ((py - this.view.y) * k) / this.view.k,
    };
    this.requestRedraw();
  }

  screenToWorld(ev: { clientX: number; clientY: number }): Point {
    const rect = this.svg.getBoundingClientRect();
    return {
      x: (ev.clientX - rect.left - this.view.x) / this.view.k,
      y: (ev.clientY - rect.top - this.view.y) / this.view.k,
    };
  }
}
