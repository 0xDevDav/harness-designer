import type { RendererApi } from "@/app/context";
import { colorOf, isLightColor } from "@/core/colors";
import {
  findInline,
  findNode,
  findSegment,
  findTable,
  nodeDegree,
  nodeForTable,
  segmentEnds,
  segmentsOf,
  tableForNode,
} from "@/core/doc";
import { clamp, readableAngle } from "@/core/geometry";
import type { Store } from "@/core/store";
import type { HarnessDoc, HNode, Inline, Point, Rect, Segment, Selection } from "@/core/types";
import type { Translate } from "@/i18n";
import { drawJunctionBoot } from "./boot";
import { connectorSymbol } from "./connectors";
import { drawTable, tableSize } from "./tables";
import { checkWireEnds } from "@/core/wireends";
import { el, text, textWidth } from "./svg";
import { palette, withPaper } from "./palette";
import { BEND_R, drawWirePreview, fillet } from "./wires";

/* ---------------- rendering constants ---------------- */

/** Thicknesses of the branch double line and of the transparent hit area. */
const W_OUTER = 9;
const W_INNER = 5.5;
const W_HIT = 16;
/** Radius of the invisible circle that makes a junction grabbable. */
const NODE_HIT_R = 11;
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 4;
/** Highest zoom the automatic fit may reach; beyond it the drawing blows up. */
const FIT_ZOOM = 2;
/** Margin around the content, in document units. */
const CONTENT_MARGIN = 70;
/** Box used when the document is empty. */
const EMPTY_BOX: Rect = { x: 0, y: 0, w: 800, h: 600 };

const gridPattern = (): string =>
  '<pattern id="gridP" width="20" height="20" patternUnits="userSpaceOnUse">' +
  `<path d="M20 0H0V20" fill="none" stroke="${palette().grid}" stroke-width="1"/></pattern>`;

export interface RendererOptions {
  store: Store;
  t: Translate;
  svg: SVGSVGElement;
  world: SVGGElement;
  zoomLabel?: HTMLElement | null;
}

/**
 * Drawing engine. It always redraws everything: `#world` is emptied and rebuilt
 * from the document. The cost is negligible next to the complexity of a
 * differential update, and no state can drift out of step.
 *
 * L'unica accortezza è temporale: i ridisegni richiesti nello stesso frame
 * are coalesced, so a drag does not pay for one draw per event.
 */
export class Renderer implements RendererApi {
  hoverNodeId: string | null = null;
  branchPreviewTo: Point | null = null;

  private readonly store: Store;
  private readonly t: Translate;
  private readonly svg: SVGSVGElement;
  private readonly world: SVGGElement;
  private readonly zoomLabel: HTMLElement | null;

  private frame: number | null = null;
  /** Grid box during export; outside export the grid is unbounded. */
  private exportRect: Rect | null = null;

  constructor(opts: RendererOptions) {
    this.store = opts.store;
    this.t = opts.t;
    this.svg = opts.svg;
    this.world = opts.world;
    this.zoomLabel = opts.zoomLabel ?? null;
  }

  /* ---------------- draw cycle ---------------- */

  requestRedraw(): void {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.redrawNow();
    });
  }

  redrawNow(): void {
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
    }
    this.draw();
  }

  private draw(): void {
    const doc = this.store.doc;
    const view = this.store.view;
    const exporting = this.exportRect !== null;
    const world = this.world;

    world.replaceChildren();
    world.setAttribute("transform", `translate(${view.x},${view.y}) scale(${view.k})`);

    // The grid is a pattern defined in the document, so its colour has to be
    // realigned with the theme, or it would stay the light one from the HTML and on
    // a dark background it would swamp the drawing.
    this.svg.querySelector("#gridP path")?.setAttribute("stroke", palette().grid);

    const grid = this.exportRect ?? { x: -5000, y: -5000, w: 12000, h: 12000 };
    el(
      "rect",
      { x: grid.x, y: grid.y, width: grid.w, height: grid.h, fill: "url(#gridP)", "pointer-events": "none" },
      world,
    );

    // layer order is the visual contract: whatever comes later covers
    const gTables = el("g", {}, world);
    const gSegOuter = el("g", {}, world);
    const gSegInner = el("g", {}, world);
    const gBoot = el("g", {}, world);
    const gJunctions = el("g", {}, world);
    // Strands run over the bundle and over the junction boots, so a wire is
    // followed from end to end without disappearing under every fitting on the
    // way. They stay under the dimensions and the inline labels, which is why
    // the branch labels have a layer of their own up here rather than sitting
    // with the branch that owns them.
    const gStrands = el("g", { "pointer-events": "none" }, world);
    const gSegLabels = el("g", {}, world);
    const gInlines = el("g", {}, world);
    const gConnectors = el("g", {}, world);
    const gOverlay = el("g", { "pointer-events": "none" }, world);

    // rows conflicting with the two-ends rule are computed once per draw and
    // apply to every table involved
    const wireErrors = checkWireEnds(doc).rowsByTable;
    for (const table of doc.tables) {
      drawTable(table, doc.meta, this.t, gTables, wireErrors.get(table.id));
    }
    for (const seg of doc.segments) this.drawSegment(doc, seg, gSegOuter, gSegInner, gSegLabels);
    this.drawBends(doc, gSegOuter, gSegInner);
    if (!exporting) drawWirePreview(doc, this.store.selection, gStrands);
    for (const node of doc.nodes) drawJunctionBoot(doc, node, gBoot);
    for (const node of doc.nodes) {
      if (node.kind !== "connector") this.drawJunction(doc, node, gJunctions);
    }
    for (const inline of doc.inlines) this.drawInline(doc, inline, gInlines);
    for (const node of doc.nodes) {
      if (node.kind === "connector") this.drawConnector(doc, node, gConnectors);
    }

    if (!exporting) this.drawOverlays(doc, gOverlay);

    if (this.zoomLabel) {
      this.zoomLabel.textContent = this.t("canvas.zoom", { percent: Math.round(view.k * 100) });
    }
  }

  /* ---------------- branches ---------------- */

  /**
   * How far back a branch stops short of a node so a fillet can take the turn.
   * Zero unless exactly two branches meet there, and never more than half the
   * branch, so a short stretch between two bends cannot be eaten from both ends.
   */
  private bendInset(doc: HarnessDoc, nodeId: string, ownLength: number): number {
    const attached = segmentsOf(doc, nodeId);
    if (attached.length !== 2) return 0;
    const halves = attached.map((s) => {
      const e = segmentEnds(doc, s);
      return e ? Math.hypot(e[1].x - e[0].x, e[1].y - e[0].y) / 2 : 0;
    });
    return Math.min(BEND_R, ownLength / 2, ...halves);
  }

  /**
   * Fillets at the nodes where one run simply changes direction.
   *
   * Only where exactly two branches meet. Where three or more do, the boot is
   * the fitting and a fillet under it would be invisible anyway.
   *
   * The cut is `BEND_R` from `wires.ts` and the arc follows from it, which is
   * the same thing the strands inside the bundle are drawn on: a cable that
   * bends on one radius with its own wires on another reads as a mistake before
   * you can say why.
   */
  private drawBends(doc: HarnessDoc, outer: SVGGElement, inner: SVGGElement): void {
    for (const node of doc.nodes) {
      const attached = segmentsOf(doc, node.id);
      if (attached.length !== 2) continue;

      const arms: Point[] = [];
      for (const seg of attached) {
        const ends = segmentEnds(doc, seg);
        if (!ends) continue;
        const far = ends[0].id === node.id ? ends[1] : ends[0];
        const dx = far.x - node.x;
        const dy = far.y - node.y;
        const len = Math.hypot(dx, dy);
        if (!len) continue;
        const r = this.bendInset(doc, node.id, len);
        arms.push({ x: node.x + (dx / len) * r, y: node.y + (dy / len) * r });
      }
      if (arms.length !== 2) continue;

      const d = `M${arms[0]!.x},${arms[0]!.y} ${fillet(arms[0]!, node, arms[1]!)}`;
      const shape = { d, fill: "none", "stroke-linecap": "round", "pointer-events": "none" };
      el("path", { ...shape, stroke: palette().bundleOuter, "stroke-width": W_OUTER }, outer);
      el("path", { ...shape, stroke: palette().bundleInner, "stroke-width": W_INNER }, inner);
    }
  }

  private drawSegment(
    doc: HarnessDoc,
    seg: Segment,
    outer: SVGGElement,
    inner: SVGGElement,
    labels: SVGGElement,
  ): void {
    const ends = segmentEnds(doc, seg);
    if (!ends) return;
    const [a, b] = ends;

    // the drawn line stops short of a bend; the hit line does not, so the whole
    // branch stays grabbable right up to the node
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    const ia = this.bendInset(doc, a.id, len);
    const ib = this.bendInset(doc, b.id, len);
    const line = {
      x1: a.x + ux * ia,
      y1: a.y + uy * ia,
      x2: b.x - ux * ib,
      y2: b.y - uy * ib,
      "stroke-linecap": "round",
    };

    el(
      "line",
      { ...line, stroke: palette().bundleOuter, "stroke-width": W_OUTER, "pointer-events": "none" },
      outer,
    );
    el(
      "line",
      { ...line, stroke: palette().bundleInner, "stroke-width": W_INNER, "pointer-events": "none" },
      inner,
    );
    // invisible thick line: the branch stays grabbable with a fingertip too
    el(
      "line",
      {
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        "stroke-linecap": "round",
        stroke: "transparent",
        "stroke-width": W_HIT,
        "data-ent": "segment",
        "data-id": seg.id,
        style: "cursor:pointer",
      },
      inner,
    );

    const label = [seg.len, seg.refs].filter(Boolean).join(" ");
    if (!label) return;

    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    let nx = -Math.sin(angle);
    let ny = Math.cos(angle);
    // the label always sits above the branch, whichever way it was drawn
    if (ny > 0) {
      nx = -nx;
      ny = -ny;
    }
    const lx = (a.x + b.x) / 2 + nx * 14;
    const ly = (a.y + b.y) / 2 + ny * 14;
    const deg = readableAngle(angle);
    const rotate = `rotate(${deg} ${lx} ${ly})`;

    text(
      lx,
      ly,
      label,
      {
        "font-size": 12,
        fill: palette().text,
        "text-anchor": "middle",
        transform: rotate,
        "data-ent": "segment",
        "data-id": seg.id,
        style: "cursor:pointer",
      },
      labels,
    );

    // only the length is underlined, which sets it apart from note references
    if (seg.len) {
      const start = lx - textWidth(label, 12) / 2;
      el(
        "line",
        {
          x1: start,
          y1: ly + 2.5,
          x2: start + textWidth(seg.len, 12),
          y2: ly + 2.5,
          stroke: palette().text,
          "stroke-width": 1,
          transform: rotate,
          "pointer-events": "none",
        },
        labels,
      );
    }
  }

  /* ---------------- nodes ---------------- */

  private drawJunction(doc: HarnessDoc, node: HNode, parent: SVGGElement): void {
    // the small square is only for a lone node; otherwise the boot is enough
    if (nodeDegree(doc, node.id) === 0) {
      el(
        "rect",
        {
          x: node.x - 4.5,
          y: node.y - 4.5,
          width: 9,
          height: 9,
          fill: palette().bundleInner,
          stroke: palette().bundleOuter,
          "stroke-width": 1.4,
          "data-ent": "node",
          "data-id": node.id,
          style: "cursor:move",
        },
        parent,
      );
    }
    el(
      "circle",
      {
        cx: node.x,
        cy: node.y,
        r: NODE_HIT_R,
        fill: "transparent",
        "data-ent": "node",
        "data-id": node.id,
        style: "cursor:move",
      },
      parent,
    );
  }

  /** Angle of the attached branch, from the node towards the bundle. */
  private attachAngle(doc: HarnessDoc, node: HNode): number {
    const seg = segmentsOf(doc, node.id)[0];
    if (!seg) return 0;
    const other = findNode(doc, seg.a === node.id ? seg.b : seg.a);
    if (!other) return 0;
    return Math.atan2(other.y - node.y, other.x - node.x);
  }

  private drawConnector(doc: HarnessDoc, node: HNode, parent: SVGGElement): void {
    const angle = this.attachAngle(doc, node);
    const symbol = connectorSymbol(node.style) ?? connectorSymbol("plug");

    const g = el(
      "g",
      {
        transform: `translate(${node.x},${node.y})`,
        "data-ent": "node",
        "data-id": node.id,
        style: "cursor:move",
      },
      parent,
    );
    // the symbol is drawn with the wire entering from the right, so rotating the group is enough
    const rotated = el("g", { transform: `rotate(${(angle * 180) / Math.PI})` }, g);
    symbol?.draw(rotated);

    const label = [node.name, node.refs].filter(Boolean).join(" ");
    if (!label) return;
    // the label follows the connector axis past the nose, so it overlaps no corner
    const tip = symbol?.tip ?? 40;
    const d = tip + 6 + textWidth(label, 12.5, true) / 2;
    text(
      node.x - Math.cos(angle) * d,
      node.y - Math.sin(angle) * d + 4,
      label,
      {
        "font-size": 12.5,
        "font-weight": 600,
        fill: palette().text,
        "text-anchor": "middle",
        "data-ent": "node",
        "data-id": node.id,
        style: "cursor:move",
      },
      parent,
    );
  }

  /* ---------------- labels on the branch ---------------- */

  private drawInline(doc: HarnessDoc, inline: Inline, parent: SVGGElement): void {
    const seg = findSegment(doc, inline.seg);
    if (!seg) return;
    const ends = segmentEnds(doc, seg);
    if (!ends) return;
    const [a, b] = ends;

    const x = a.x + (b.x - a.x) * inline.t;
    const y = a.y + (b.y - a.y) * inline.t;
    const deg = readableAngle(Math.atan2(b.y - a.y, b.x - a.x));
    const label = inline.text;
    const w = Math.max(26, textWidth(label, 11, true) + 12);
    const h = 15;
    const fill = colorOf(inline.color) ?? (inline.color || "#e8942a");

    const g = el(
      "g",
      {
        transform: `translate(${x},${y}) rotate(${deg})`,
        "data-ent": "inline",
        "data-id": inline.id,
        style: "cursor:move",
      },
      parent,
    );
    el(
      "rect",
      { x: -w / 2, y: -h / 2, width: w, height: h, rx: 3, fill, stroke: palette().text, "stroke-width": 1 },
      g,
    );
    text(
      0,
      3.8,
      label,
      {
        "font-size": 10.5,
        "font-weight": 600,
        "text-anchor": "middle",
        fill: isLightColor(fill) ? "#222" : palette().bundleInner,
      },
      g,
    );
  }

  /* ---------------- sovrapposizioni ---------------- */

  private drawOverlays(doc: HarnessDoc, parent: SVGGElement): void {
    const hover = this.hoverNodeId ? findNode(doc, this.hoverNodeId) : undefined;
    if (hover) {
      el(
        "circle",
        {
          cx: hover.x,
          cy: hover.y,
          r: 15,
          fill: "rgba(61,139,253,.14)",
          stroke: palette().selection,
          "stroke-width": 1.8,
          "pointer-events": "none",
        },
        parent,
      );
    }

    // preview of the branch being drawn: it starts at the last point placed, which is also the selected one
    const sel = this.store.selection;
    if (this.store.tool === "branch" && this.branchPreviewTo && sel?.type === "node") {
      const from = findNode(doc, sel.id);
      const to = hover ?? this.branchPreviewTo;
      if (from) {
        el(
          "line",
          {
            x1: from.x,
            y1: from.y,
            x2: to.x,
            y2: to.y,
            stroke: palette().selection,
            "stroke-width": 2,
            "stroke-dasharray": "5 4",
            "pointer-events": "none",
          },
          parent,
        );
      }
    }

    this.drawSelection(doc, parent);
  }

  /**
   * A selected branch, lit along its own line: a wide soft halo under the
   * bundle plus a thin bright edge on it. Nothing is dashed, so nothing here
   * can be read as a wire.
   */
  private drawSegmentSelection(doc: HarnessDoc, segId: string, parent: SVGGElement): void {
    const seg = findSegment(doc, segId);
    const ends = seg ? segmentEnds(doc, seg) : null;
    if (!ends) return;
    const [a, b] = ends;
    const line = { x1: a.x, y1: a.y, x2: b.x, y2: b.y, "stroke-linecap": "round" };

    el("line", { ...line, stroke: palette().selection, "stroke-width": W_OUTER + 11, opacity: 0.22 }, parent);
    el("line", { ...line, stroke: palette().selection, "stroke-width": W_OUTER + 2, opacity: 0.55 }, parent);

    // the ends are marked so a branch stays distinguishable from the one next
    // to it when several meet at a junction
    for (const p of [a, b]) {
      el(
        "circle",
        { cx: p.x, cy: p.y, r: 4.5, fill: "none", stroke: palette().selection, "stroke-width": 2 },
        parent,
      );
    }
  }

  /**
   * Everything selected, drawn the same way whether one element or several were
   * picked. Ctrl adds to the selection and the elements it adds are not lesser
   * ones, so they get the same outline rather than a fainter one.
   */
  private drawSelection(doc: HarnessDoc, parent: SVGGElement): void {
    for (const sel of this.store.selected()) this.drawOneSelection(doc, sel, parent);
  }

  private drawOneSelection(doc: HarnessDoc, sel: Selection, parent: SVGGElement): void {
    // A branch is a line, so it is lit along its length rather than boxed. A
    // rectangle round a diagonal branch encloses mostly empty sheet, and its
    // dashed edges run alongside the strands closely enough to be mistaken for
    // one of them, which defeats the preview it sits on top of.
    if (sel.type === "segment") {
      this.drawSegmentSelection(doc, sel.id, parent);
      return;
    }

    const box = this.entityBBox(sel);
    if (!box) return;
    el(
      "rect",
      {
        x: box.x,
        y: box.y,
        width: box.w,
        height: box.h,
        fill: "none",
        stroke: palette().selection,
        "stroke-width": 1.6,
        "stroke-dasharray": "6 4",
        rx: 4,
      },
      parent,
    );

    // table to connector link: the twin element is highlighted as well
    const linked = this.linkedBBox(doc, sel);
    if (!linked) return;
    el(
      "rect",
      {
        x: linked.x,
        y: linked.y,
        width: linked.w,
        height: linked.h,
        fill: "none",
        stroke: palette().selection,
        "stroke-width": 1.4,
        "stroke-dasharray": "2 4",
        rx: 4,
        opacity: 0.55,
      },
      parent,
    );
  }

  private linkedBBox(doc: HarnessDoc, sel: Selection): Rect | null {
    if (sel.type === "node") {
      const table = tableForNode(doc, sel.id);
      return table ? this.tableBox(doc, table.id) : null;
    }
    if (sel.type === "table") {
      const table = findTable(doc, sel.id);
      const node = table ? nodeForTable(doc, table) : undefined;
      return node ? nodeBox(node) : null;
    }
    return null;
  }

  private tableBox(doc: HarnessDoc, id: string): Rect | null {
    const table = findTable(doc, id);
    if (!table) return null;
    const { w, h } = tableSize(table, doc.meta, this.t);
    return { x: table.x - 4, y: table.y - 4, w: w + 8, h: h + 8 };
  }

  /* ---------------- riquadri ---------------- */

  entityBBox(selection: Selection): Rect | null {
    const doc = this.store.doc;
    if (selection.type === "node") {
      const node = findNode(doc, selection.id);
      return node ? nodeBox(node) : null;
    }
    if (selection.type === "segment") {
      const seg = findSegment(doc, selection.id);
      const ends = seg ? segmentEnds(doc, seg) : null;
      if (!ends) return null;
      const [a, b] = ends;
      return {
        x: Math.min(a.x, b.x) - 10,
        y: Math.min(a.y, b.y) - 10,
        w: Math.abs(a.x - b.x) + 20,
        h: Math.abs(a.y - b.y) + 20,
      };
    }
    if (selection.type === "inline") {
      const inline = findInline(doc, selection.id);
      const seg = inline ? findSegment(doc, inline.seg) : undefined;
      const ends = seg ? segmentEnds(doc, seg) : null;
      if (!inline || !ends) return null;
      const [a, b] = ends;
      return {
        x: a.x + (b.x - a.x) * inline.t - 30,
        y: a.y + (b.y - a.y) * inline.t - 14,
        w: 60,
        h: 28,
      };
    }
    return this.tableBox(doc, selection.id);
  }

  selectionBBox(): Rect | null {
    const sel = this.store.selection;
    return sel ? this.entityBBox(sel) : null;
  }

  contentBBox(): Rect {
    const doc = this.store.doc;
    let x1 = Infinity;
    let y1 = Infinity;
    let x2 = -Infinity;
    let y2 = -Infinity;
    const add = (x: number, y: number): void => {
      x1 = Math.min(x1, x);
      y1 = Math.min(y1, y);
      x2 = Math.max(x2, x);
      y2 = Math.max(y2, y);
    };

    for (const node of doc.nodes) add(node.x, node.y);
    for (const table of doc.tables) {
      const { w, h } = tableSize(table, doc.meta, this.t);
      add(table.x, table.y);
      add(table.x + w, table.y + h);
    }
    if (x1 > x2) return { ...EMPTY_BOX };
    return {
      x: x1 - CONTENT_MARGIN,
      y: y1 - CONTENT_MARGIN,
      w: x2 - x1 + CONTENT_MARGIN * 2,
      h: y2 - y1 + CONTENT_MARGIN * 2,
    };
  }

  /* ---------------- view ---------------- */

  fitView(): void {
    const box = this.contentBBox();
    const rect = this.svg.getBoundingClientRect();
    const raw = Math.min(rect.width / box.w, rect.height / box.h);
    // while the window has no size yet the ratio is unusable
    const k = Number.isFinite(raw) && raw > 0 ? clamp(raw, MIN_ZOOM, FIT_ZOOM) : 1;
    this.store.setView({
      k,
      x: (rect.width - box.w * k) / 2 - box.x * k,
      y: (rect.height - box.h * k) / 2 - box.y * k,
    });
  }

  centerOn(rect: Rect): void {
    const area = this.svg.getBoundingClientRect();
    const k = this.store.view.k;
    this.store.setView({
      k,
      x: area.width / 2 - (rect.x + rect.w / 2) * k,
      y: area.height / 2 - (rect.y + rect.h / 2) * k,
    });
  }

  /** `pivotScreen` is in window coordinates (clientX/clientY), like the events. */
  zoomBy(factor: number, pivotScreen?: Point): void {
    const view = this.store.view;
    const k = clamp(view.k * factor, MIN_ZOOM, MAX_ZOOM);
    if (k === view.k) return;
    const rect = this.svg.getBoundingClientRect();
    const px = pivotScreen ? pivotScreen.x - rect.left : rect.width / 2;
    const py = pivotScreen ? pivotScreen.y - rect.top : rect.height / 2;
    // the point under the pointer stays put
    this.store.setView({
      k,
      x: px - ((px - view.x) * k) / view.k,
      y: py - ((py - view.y) * k) / view.k,
    });
  }

  screenToWorld(ev: { clientX: number; clientY: number }): Point {
    const rect = this.svg.getBoundingClientRect();
    const view = this.store.view;
    return {
      x: (ev.clientX - rect.left - view.x) / view.k,
      y: (ev.clientY - rect.top - view.y) / view.k,
    };
  }

  /** The reverse conversion, used to place the editor over the right cell. */
  worldToScreen(point: Point): Point {
    const rect = this.svg.getBoundingClientRect();
    const view = this.store.view;
    return {
      x: point.x * view.k + view.x + rect.left,
      y: point.y * view.k + view.y + rect.top,
    };
  }

  nodeNear(point: Point, radius: number): string | null {
    let best: string | null = null;
    let bestDist = radius;
    for (const node of this.store.doc.nodes) {
      const d = Math.hypot(node.x - point.x, node.y - point.y);
      if (d < bestDist) {
        bestDist = d;
        best = node.id;
      }
    }
    return best;
  }

  /* ---------------- export ---------------- */

  /**
   * Self-contained SVG of the whole drawing. It redraws in a neutral state (no
   * selection, no highlights, grid limited to the content), captures the
   * contents of `#world` and restores the working state straight away.
   */
  renderToString(): string {
    const box = this.contentBBox();
    const w = Math.max(1, Math.round(box.w));
    const h = Math.max(1, Math.round(box.h));

    // the contents of `#world` are already in document coordinates: the current
    // view lives on the `transform` attribute and never reaches the export
    this.exportRect = box;
    // The exported drawing is always on white paper, even while working in the
    // dark theme: it ends up on a printed sheet, not on a screen.
    let inner = "";
    let pattern = "";
    try {
      withPaper(() => {
        this.redrawNow();
        inner = this.world.innerHTML;
        pattern = gridPattern();
      });
    } finally {
      this.exportRect = null;
      this.redrawNow();
    }

    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
      `<defs>${pattern}</defs>` +
      `<rect width="100%" height="100%" fill="#ffffff"/>` +
      `<g transform="translate(${-box.x},${-box.y})">${inner}</g>` +
      `</svg>`
    );
  }
}

/** Selection box of a node, taking in both symbol and label. */
function nodeBox(node: HNode): Rect {
  return { x: node.x - 30, y: node.y - 24, w: 60, h: 48 };
}
