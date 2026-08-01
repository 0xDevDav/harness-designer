/**
 * The schematic: the same harness read as circuits instead of as a shape.
 *
 * The formboard answers "how is it built" — where the bundle runs, how long
 * each branch is, which way a connector points. It is the drawing that goes to
 * the workshop, and it is deliberately not a circuit diagram: two wires side by
 * side in the same trunk tell you nothing about whether they are the same
 * signal.
 *
 * This answers the other question, "what is connected to what". Every connector
 * becomes a box of its cavities, every wire in the list becomes a line from one
 * cavity to another, drawn in the colour it is really made of. Nothing here is
 * new information: it is the cavity tables read a second way, which is exactly
 * why it cannot drift out of step with them.
 *
 * The model is built from the document on every draw and holds no state. The
 * one thing that is remembered is where somebody has dragged a box, and that
 * lives in the document (`doc.schematic`), so it is saved, undone and reopened
 * with the drawing.
 */

import { cavityTables, cell, nodeForTable, DEST_RE } from "./doc";
import { colorsOf } from "./colors";
import { endpointConnector, routeWires } from "./routing";
import type { RoutedWire } from "./routing";
import type { HarnessDoc, Point, Rect, Selection } from "./types";

/* ---------------- shape of a box ---------------- */

/** Height of the header carrying the connector name. */
export const HEAD_H = 26;
/** Height of one cavity row. */
export const PIN_H = 18;
/** Padding under the last row, so the box does not end on the text. */
export const BOX_PAD = 6;
const MIN_W = 124;
/**
 * How wide a box may get for its rows. The title is not held to it: a cavity
 * table is called what it is called, and a box that says «C13 — Presa rimo…»
 * has thrown away the half of the name that told you which one it is.
 */
const MAX_W = 260;
/** Widest a title may make a box before it stops being a box. */
const MAX_TITLE_W = 520;
/** Rough width of a character at the size the rows are drawn: layout only. */
const CHAR_W = 6.1;
/** The same, for the heavier and larger type of the header. */
const TITLE_CHAR_W = 7.2;
/** Space kept between two columns of boxes, where the wires run. */
const COL_GAP = 280;
/** Space between two boxes in the same column. */
const ROW_GAP = 34;
/**
 * How far a wire leaves a box before it turns.
 *
 * Long enough for the turn to be a curve rather than a kink: a corner can only
 * be rounded by half of the shorter of the two runs meeting at it, so the reach
 * out of the connector is what decides how wide the wires bend on their way
 * anywhere. It also keeps the fan of a busy connector clear of the box before
 * it starts spreading.
 */
const STUB = 28;
/** Distance between two wires sharing a vertical channel. */
const LANE = 14;
/** Widest a channel may spread before it starts reaching into the boxes. */
const MAX_LANE_SPREAD = 190;
/**
 * Closest two wires are ever drawn to each other.
 *
 * Wires are drawn about two units thick, so anything under this reads as one
 * wire with a thick spot rather than as two. It is a floor and not a target: a
 * channel with more wires in it than the spread allows grows wider instead of
 * packing them tighter, because a schematic that has to be zoomed into to count
 * the wires is not telling you how many there are.
 */
const MIN_LANE = 10;
/** Distance between two wires that land on the same port. */
const PORT_LANE = 8;

/** The port a wire reaches a box by. `pin` is -1 for the box as a whole. */
export interface SchemPort {
  box: string;
  pin: number;
}

export interface SchemPin {
  /** cavity as the table writes it */
  cavity: string;
  /** what the wire does, or where it goes when nothing says what it does */
  label: string;
  /** colour cell, as written */
  color: string;
  section: string;
  /** row of the cavity table this pin came from */
  row: number;
}

export interface SchemBox {
  /** connector name: it is what the cavity tables refer to each other by */
  id: string;
  /**
   * What the header says: the title of the cavity table, in full, exactly as
   * the sheet writes it. The two views have to call the same connector the same
   * thing, or reading them side by side means matching them up by hand. Only a
   * connector with no table of its own falls back to its bare name.
   */
  title: string;
  /** node on the sheet, when the drawing has one */
  nodeId?: string;
  /** its cavity table, when it has one */
  tableId?: string;
  pins: SchemPin[];
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * A name the tables send a wire to and the drawing does not have. It is drawn
   * so the wire has somewhere to land — losing the wire would hide the mistake
   * instead of showing it.
   */
  unknown?: boolean;
  /** true while the box sits where somebody put it */
  placed?: boolean;
}

export interface SchemWire {
  /** stable while the two endpoints are written the way they are */
  id: string;
  from: SchemPort;
  to: SchemPort;
  /** endpoints as the tables write them, for the label and the report */
  fromLabel: string;
  toLabel: string;
  func: string;
  section: string;
  /** colour cell as written, and its bands once resolved */
  color: string;
  bands: string[] | null;
  /** the line, already routed: corners only, no curves */
  points: Point[];
  /** branches it runs through on the sheet */
  segments: string[];
  /** the two ends exist but no chain of branches joins them */
  unreachable: boolean;
}

/**
 * Two connectors that plug into each other.
 *
 * Not a wire and not drawn as one: nothing is cut to this length and no colour
 * runs along it. It is the point where one wire ends and the next begins, which
 * is exactly why the colour is free to change from one side to the other — and
 * a schematic that left it out would show two connectors with no relationship
 * at all and a circuit that stops dead.
 */
export interface SchemJoint {
  a: string;
  b: string;
  from: Point;
  to: Point;
}

export interface Schematic {
  boxes: SchemBox[];
  wires: SchemWire[];
  joints: SchemJoint[];
  byName: Map<string, SchemBox>;
  /** box and wire together, with a margin */
  bbox: Rect;
}

/* ---------------- boxes ---------------- */

const trimmed = (v: string): string => v.trim();

/**
 * Width a box needs for what it has to say.
 *
 * The rows are held to a limit — a long function name is shortened, and the
 * cavity next to it still says which wire it is about. The title is not: it is
 * the name of the thing, it is what the other view calls it, and it is the one
 * piece of text on the box that has to be read whole.
 */
function boxWidth(title: string, pins: readonly SchemPin[]): number {
  let rows = MIN_W;
  for (const pin of pins) {
    // cavity, label and the colour swatch, which is drawn at a fixed size
    rows = Math.max(rows, (pin.cavity.length + pin.label.length) * CHAR_W + 54);
  }
  const head = title.length * TITLE_CHAR_W + 22;
  return Math.round(Math.max(MIN_W, Math.min(MAX_W, rows), Math.min(MAX_TITLE_W, head)));
}

/**
 * How tall a box has to be.
 *
 * A connector is as tall as its cavities. A splice or a ring terminal has none
 * and is as tall as the fan of wires meeting on it needs instead: nine wires
 * spliced together take the room to be shown as nine, and a box sized for one
 * would have them arriving in a bundle nobody could count.
 */
const boxHeight = (pins: readonly SchemPin[], landings = 0): number =>
  pins.length
    ? HEAD_H + pins.length * PIN_H + BOX_PAD
    : HEAD_H + Math.max(PIN_H, landings * PORT_LANE + 10) + BOX_PAD;

/** Middle of the body of a box: below the header, which carries the name. */
const bodyCentre = (box: SchemBox): number => HEAD_H + (box.h - HEAD_H - BOX_PAD) / 2;

/**
 * One box per connector.
 *
 * A connector with a cavity table shows its cavities; one without still gets a
 * box, because a ring terminal or a splice is part of the circuit even though
 * it has nothing to number. Junctions are left out: a node the bundle merely
 * runs through is a fact about the shape of the harness, not about the circuit.
 */
function buildBoxes(doc: HarnessDoc): SchemBox[] {
  const boxes = new Map<string, SchemBox>();
  const blank = (id: string): SchemBox => ({
    id,
    title: id,
    pins: [],
    x: 0,
    y: 0,
    w: MIN_W,
    h: boxHeight([]),
  });

  for (const { table, cols, owner } of cavityTables(doc)) {
    const pins: SchemPin[] = [];
    table.rows.forEach((row, index) => {
      const cavity = cell(row, cols.cavity);
      if (!cavity) return;
      const func = cell(row, cols.func);
      pins.push({
        cavity,
        label: func || cell(row, cols.dest),
        color: cell(row, cols.color),
        section: cell(row, cols.section),
        row: index,
      });
    });
    const box = boxes.get(owner) ?? blank(owner);
    // two tables for one connector is a mistake the check reports; here the
    // first one wins, so the box stays a box instead of doubling its cavities
    if (!box.tableId) {
      box.pins = pins;
      box.tableId = table.id;
      box.nodeId = nodeForTable(doc, table)?.id;
      box.title = table.title?.trim() || owner;
    }
    boxes.set(owner, box);
  }

  for (const node of doc.nodes) {
    const name = trimmed(node.name);
    if (!name || node.kind !== "connector") continue;
    const box = boxes.get(name) ?? blank(name);
    box.nodeId ??= node.id;
    boxes.set(name, box);
  }

  for (const box of boxes.values()) {
    box.w = boxWidth(box.title, box.pins);
    box.h = boxHeight(box.pins);
  }
  return [...boxes.values()];
}

/* ---------------- layout ---------------- */

/** One end of a wire seen by the layout: which box, and which cavity of it. */
interface Tie {
  box: string;
  pin: number;
  other: string;
  otherPin: number;
}

/** Where a box would sit on the sheet: its connector, or its table. */
function anchorOf(doc: HarnessDoc, box: SchemBox): Point {
  const node = box.nodeId ? doc.nodes.find((n) => n.id === box.nodeId) : undefined;
  if (node) return { x: node.x, y: node.y };
  const table = box.tableId ? doc.tables.find((t) => t.id === box.tableId) : undefined;
  return table ? { x: table.x, y: table.y } : { x: 0, y: 0 };
}

/** Both ends of every wire — and of every joint — indexed by the box they touch. */
function tiesOf(
  pairs: readonly ResolvedPair[],
  mates: readonly (readonly [string, string])[],
  free: ReadonlySet<string>,
): Map<string, Tie[]> {
  const ties = new Map<string, Tie[]>();
  const add = (tie: Tie): void => {
    if (!free.has(tie.box) || !free.has(tie.other) || tie.box === tie.other) return;
    const list = ties.get(tie.box);
    if (list) list.push(tie);
    else ties.set(tie.box, [tie]);
  };
  for (const pair of pairs) {
    add({ box: pair.from.box, pin: pair.from.pin, other: pair.to.box, otherPin: pair.to.pin });
    add({ box: pair.to.box, pin: pair.to.pin, other: pair.from.box, otherPin: pair.from.pin });
  }
  // A mated pair holds the layout together as firmly as a wire does: no wire
  // crosses a joint, so without this the two halves would be laid out as two
  // unrelated drawings and end up at opposite ends of the sheet. Tied by the
  // header, they come out side by side and level, which is where the arrow
  // between them reads as one thing plugged into another.
  for (const [a, b] of mates) {
    add({ box: a, pin: -1, other: b, otherPin: -1 });
    add({ box: b, pin: -1, other: a, otherPin: -1 });
  }
  return ties;
}

/**
 * Columns, worked out from what is wired to what.
 *
 * Each stretch of the harness that hangs together is walked outwards from its
 * busiest connector: that one takes the first column, whatever it feeds takes
 * the second, and so on. Distance along the wiring is what puts a box in a
 * column, so a wire goes from one column to the next instead of doubling back
 * across the sheet, and a connector everything hangs off ends up with its fan
 * of wires spread in front of it.
 */
function columnsOf(boxes: readonly SchemBox[], ties: Map<string, Tie[]>): SchemBox[][] {
  const level = new Map<string, number>();
  const roots = [...boxes].sort(
    (a, b) => (ties.get(b.id)?.length ?? 0) - (ties.get(a.id)?.length ?? 0) || a.id.localeCompare(b.id),
  );

  for (const root of roots) {
    if (level.has(root.id)) continue;
    level.set(root.id, 0);
    const queue = [root.id];
    for (let head = 0; head < queue.length; head++) {
      const at = queue[head]!;
      const depth = level.get(at) ?? 0;
      for (const tie of ties.get(at) ?? []) {
        if (level.has(tie.other)) continue;
        level.set(tie.other, depth + 1);
        queue.push(tie.other);
      }
    }
  }

  const columns: SchemBox[][] = [];
  for (const box of boxes) {
    const index = level.get(box.id) ?? 0;
    while (columns.length <= index) columns.push([]);
    columns[index]!.push(box);
  }
  return columns;
}

/** Lays a column out from the top, honouring where each box would rather be. */
function stackColumn(column: readonly SchemBox[], wanted: Map<string, number>): void {
  let bottom: number | null = null;
  for (const box of column) {
    const want = wanted.get(box.id);
    box.y = bottom === null ? (want ?? 0) : Math.max(want ?? bottom + ROW_GAP, bottom + ROW_GAP);
    bottom = box.y + box.h;
  }
}

/** Middle value of a list, which is what a fan of wires should line up on. */
function median(values: readonly number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const half = sorted.length >> 1;
  return sorted.length % 2 ? sorted[half]! : (sorted[half - 1]! + sorted[half]!) / 2;
}

/**
 * Automatic arrangement: columns left to right, and inside each column the
 * order that has the wires crossing each other as little as possible.
 *
 * The order is not read off the drawing. On the sheet a connector sits where
 * the harness physically puts it, and copying that here produces a schematic
 * whose wires cross for reasons that have nothing to do with the circuit. So
 * each column is sorted by where its wires arrive from — the median of the
 * cavities at the other end, the standard way of untangling a layered drawing —
 * and then the pass is run again both ways, because moving one column changes
 * the answer for its neighbours.
 *
 * Then each box is pulled towards the middle of its own wires, as far as the
 * boxes above it allow. That is what turns a correct order into a readable
 * one: cavity 4 of a connector ends up level with the cavity 4 goes to, and the
 * wire between them is a straight line rather than a step.
 *
 * **Every box takes part, including the ones somebody has dragged.** Their own
 * result is thrown away afterwards — they go where they were put — but they are
 * laid out all the same, because dropping one from the graph changes where all
 * the others land: take the connector everything hangs off out of it and the
 * arrangement is worked out from a different starting point, in different
 * columns and a different order. Moving one box would then rearrange the whole
 * schematic, which is not what moving one box means.
 */
function autoLayout(
  doc: HarnessDoc,
  boxes: SchemBox[],
  pairs: readonly ResolvedPair[],
  mates: readonly (readonly [string, string])[],
): void {
  const all = boxes;
  if (!all.length) return;

  const ties = tiesOf(pairs, mates, new Set(all.map((b) => b.id)));
  const anchors = new Map(all.map((b) => [b.id, anchorOf(doc, b)]));
  // the sheet decides nothing here except which of two boxes with the same
  // claim to a place goes first, so an arrangement stays recognizable
  const seed = (box: SchemBox): number => anchors.get(box.id)?.y ?? 0;

  const columns = columnsOf(all, ties);
  const byId = new Map(all.map((b) => [b.id, b]));
  const colOf = new Map<string, number>();
  columns.forEach((column, index) => column.forEach((box) => colOf.set(box.id, index)));

  // widths first: they do not depend on the order, and the order needs the x
  // of the neighbours to be settled before it can talk about their cavities
  let x = 0;
  for (const column of columns) {
    const width = Math.max(MIN_W, ...column.map((b) => b.w));
    for (const box of column) box.x = x + (width - box.w) / 2;
    x += width + COL_GAP;
  }

  for (const column of columns) {
    column.sort((a, b) => seed(a) - seed(b) || a.id.localeCompare(b.id));
    stackColumn(column, new Map());
  }

  /**
   * Two answers about a column, from the wires reaching it.
   *
   * `order` is where those wires come from: it decides which box goes above
   * which, and it deliberately knows nothing about the box's own cavities, so a
   * connector is placed by where its wires arrive rather than by how tall it
   * happens to be. `level` is where the box would have to sit for those same
   * wires to arrive straight, which is a different question and is only asked
   * once the order is settled.
   */
  const keysIn = (
    column: readonly SchemBox[],
    look: (otherColumn: number) => boolean,
  ): { order: Map<string, number>; level: Map<string, number> } => {
    const order = new Map<string, number>();
    const level = new Map<string, number>();
    for (const box of column) {
      const arrivals: number[] = [];
      const levels: number[] = [];
      for (const tie of ties.get(box.id) ?? []) {
        const other = byId.get(tie.other);
        const where = colOf.get(tie.other);
        // Which column the other end is in, never how far along the sheet it
        // happens to be drawn: two boxes of different widths in one column have
        // different x, and read off x they would each take the other for a
        // neighbour and spend every pass chasing it.
        if (!other || where === undefined || !look(where)) continue;
        const at = other.y + portOffset(other, tie.otherPin);
        arrivals.push(at);
        levels.push(at - portOffset(box, tie.pin));
      }
      const from = median(arrivals);
      const want = median(levels);
      if (from !== undefined) order.set(box.id, from);
      if (want !== undefined) level.set(box.id, want);
    }
    return { order, level };
  };

  // three sweeps, alternating direction: enough for the orders to settle on
  // anything the size of a real harness, and it costs nothing if they settle
  // on the first
  for (let round = 0; round < 3; round++) {
    const walk = columns.map((column, index) => ({ column, index }));
    for (const { column, index } of round % 2 === 0 ? walk : walk.reverse()) {
      // one side at a time, alternating: a column settled against the column
      // before it is then settled against the one after, which is what stops
      // the two ends of the drawing pulling it apart every round
      const side = keysIn(column, (other) => (round % 2 === 0 ? other < index : other > index));
      const all = keysIn(column, () => true);
      const rank = (box: SchemBox): number => side.order.get(box.id) ?? all.order.get(box.id) ?? seed(box);
      column.sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
      // Placed against the side being swept, falling back to both sides for a
      // column that has nothing on that one. Weighing every tie at once instead
      // would let a group with plenty of wires among themselves — the cabin end
      // of a harness, say — settle wherever it liked and outvote the single
      // connector that joins it to the rest, which is the tie that places it.
      const level = new Map(all.level);
      for (const [id, want] of side.level) level.set(id, want);
      stackColumn(column, level);
    }
  }

  // A column of boxes that nothing is wired to has no reason to sit anywhere in
  // particular, so it is brought level with the drawing rather than left at the
  // top of it. Everything else stays exactly where its own wires put it: moving
  // a column as a whole would undo the alignment that was the point of the
  // three passes above.
  const middleOf = (column: readonly SchemBox[]): number => {
    const first = column[0];
    const last = column[column.length - 1];
    return first && last ? (first.y + last.y + last.h) / 2 : 0;
  };
  const tied = columns.filter((column) => column.some((box) => ties.get(box.id)?.length));
  const centre = median(tied.map(middleOf)) ?? 0;
  for (const column of columns) {
    if (tied.includes(column) || !column.length) continue;
    const shift = centre - middleOf(column);
    for (const box of column) box.y += shift;
  }
}

/* ---------------- ports and routing ---------------- */

/** Middle of a cavity row, measured down from the top of its box. */
export const pinOffset = (pin: number): number => (pin < 0 ? HEAD_H / 2 : HEAD_H + pin * PIN_H + PIN_H / 2);

/**
 * Where on a box a wire lands, measured down from its top.
 *
 * A cavity is a row and the wire arrives at that row. A wire naming no cavity
 * arrives at the box itself: on the header of a connector, because that is
 * where its name is and the rows below belong to other wires — but in the
 * **middle** of a splice or a ring terminal, which has no rows at all. On one of
 * those everything arriving is the same electrical point, and hanging it off
 * the top edge draws that point as though it were a heading.
 */
export const portOffset = (box: SchemBox, pin: number): number =>
  pin >= 0 ? pinOffset(pin) : box.pins.length ? HEAD_H / 2 : bodyCentre(box);

/** The point on a box a wire is attached to. */
export function portPoint(box: SchemBox, pin: number, side: "left" | "right"): Point {
  return { x: side === "left" ? box.x : box.x + box.w, y: box.y + portOffset(box, pin) };
}

interface Draft {
  wire: SchemWire;
  a: SchemBox;
  b: SchemBox;
  aSide: "left" | "right";
  bSide: "left" | "right";
  channel: number;
  /** how far this wire sits from the middle of the port at each end */
  aShift: number;
  bShift: number;
}

/** A wire whose two ends have been found on the boxes, before anything is placed. */
interface ResolvedPair {
  route: RoutedWire;
  from: SchemPort;
  to: SchemPort;
  a: SchemBox;
  b: SchemBox;
}

/** Clearance kept between a vertical channel and the box it passes. */
const CLEARANCE = 12;

/**
 * A clear vertical strip between two bounds, given what is in the way.
 *
 * Whichever free strip lies nearest the middle wins, because that is the one a
 * wire would take if it could see: it makes the two horizontal legs the same
 * sort of length instead of one long one and one stub. If everything between
 * the bounds is taken the middle comes back anyway — a wire drawn across a box
 * is worse to look at than one drawn round it, and better than no wire.
 */
function freeChannel(from: number, to: number, blocked: readonly (readonly [number, number])[]): number {
  const middle = (from + to) / 2;
  if (to - from < 2) return middle;

  const gaps: Array<[number, number]> = [];
  let at = from;
  for (const [lo, hi] of [...blocked].sort((p, q) => p[0] - q[0])) {
    if (hi <= at) continue;
    if (lo > at) gaps.push([at, Math.min(lo, to)]);
    at = Math.max(at, hi);
    if (at >= to) break;
  }
  if (at < to) gaps.push([at, to]);

  let best: [number, number] | null = null;
  for (const gap of gaps) {
    if (gap[1] - gap[0] < 2) continue;
    const off = Math.abs((gap[0] + gap[1]) / 2 - middle);
    if (!best || off < Math.abs((best[0] + best[1]) / 2 - middle)) best = gap;
  }
  return best ? (best[0] + best[1]) / 2 : middle;
}

/**
 * Which sides two boxes face each other by, and which vertical line the wire
 * comes down between them.
 *
 * The channel has to miss whatever stands between the two: with the boxes laid
 * out in columns, a wire from the first column to the third has a whole column
 * in its way, and a line straight down the middle of it would come out of one
 * box and into another. What is in the way is only what the vertical leg would
 * actually cross, so a box well above or below the run does not push it aside
 * for nothing.
 */
function facing(a: SchemBox, b: SchemBox, aPin: number, bPin: number, boxes: readonly SchemBox[]) {
  const yFrom = a.y + portOffset(a, aPin);
  const yTo = b.y + portOffset(b, bPin);
  const top = Math.min(yFrom, yTo);
  const bottom = Math.max(yFrom, yTo);
  const blocked: Array<[number, number]> = [];
  for (const box of boxes) {
    if (box === a || box === b) continue;
    if (box.y + box.h < top || box.y > bottom) continue;
    blocked.push([box.x - CLEARANCE, box.x + box.w + CLEARANCE]);
  }

  if (b.x >= a.x + a.w) {
    return {
      aSide: "right" as const,
      bSide: "left" as const,
      channel: freeChannel(a.x + a.w + STUB, b.x - STUB, blocked),
    };
  }
  if (a.x >= b.x + b.w) {
    return {
      aSide: "left" as const,
      bSide: "right" as const,
      channel: freeChannel(b.x + b.w + STUB, a.x - STUB, blocked),
    };
  }
  // one above the other, or overlapping: both wires leave to the right and the
  // channel goes down the first clear strip past the wider of the two
  const start = Math.max(a.x + a.w, b.x + b.w) + STUB;
  return {
    aSide: "right" as const,
    bSide: "right" as const,
    channel: freeChannel(start, start + COL_GAP, blocked),
  };
}

/** Drops the middle point of three that lie on one straight line. */
function simplify(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue;
    const before = out[out.length - 2];
    if (last && before) {
      const straightX = Math.abs(before.x - last.x) < 0.01 && Math.abs(last.x - p.x) < 0.01;
      const straightY = Math.abs(before.y - last.y) < 0.01 && Math.abs(last.y - p.y) < 0.01;
      if (straightX || straightY) out.pop();
    }
    out.push({ x: p.x, y: p.y });
  }
  return out;
}

/**
 * A wire as three legs: out of the pin, along a vertical channel, into the pin
 * at the other end.
 *
 * Square, like every schematic anybody reads. What decides whether it can be
 * followed is not the shape of the corners but whether two wires end up drawn
 * on top of each other, which is what the channels are for.
 */
function routeLine(draft: Draft): Point[] {
  const from = portPoint(draft.a, draft.wire.from.pin, draft.aSide);
  const to = portPoint(draft.b, draft.wire.to.pin, draft.bSide);
  from.y += draft.aShift;
  to.y += draft.bShift;
  const outward = (side: "left" | "right"): number => (side === "left" ? -STUB : STUB);
  return simplify([
    from,
    { x: from.x + outward(draft.aSide), y: from.y },
    { x: draft.channel, y: from.y },
    { x: draft.channel, y: to.y },
    { x: to.x + outward(draft.bSide), y: to.y },
    to,
  ]);
}

/**
 * Spreads the wires that landed on the same channel.
 *
 * Without this every wire between two columns would run down the same line and
 * the schematic would be one thick vertical stripe. The order is the order the
 * wires come in, which is the order of the cavity tables, so a pin-out filled
 * in from cavity 1 downwards comes out as a fan rather than as a tangle.
 */
function spreadChannels(drafts: Draft[]): void {
  // One sweep along the sorted channels. A run of wires closer together than a
  // lane is spread evenly about its own middle, and then held clear of the run
  // before it, so spreading one can never push it into the next — which is what
  // goes wrong if the wires are simply sorted into buckets and each bucket
  // spread on its own: two channels either side of a boundary stay as close as
  // they started, and two wires get drawn as one.
  const order = [...drafts].sort((a, b) => a.channel - b.channel);
  let cursor = -Infinity;

  for (let from = 0; from < order.length;) {
    let to = from + 1;
    while (to < order.length && order[to]!.channel - order[to - 1]!.channel < LANE) to++;
    const run = order.slice(from, to);
    from = to;

    const step =
      run.length > 1 ? Math.max(MIN_LANE, Math.min(LANE, MAX_LANE_SPREAD / (run.length - 1))) : LANE;
    const middle = (run[0]!.channel + run[run.length - 1]!.channel) / 2;
    const start = Math.max(middle - ((run.length - 1) * step) / 2, cursor + step);
    run.forEach((draft, i) => {
      draft.channel = start + i * step;
    });
    cursor = start + (run.length - 1) * step;
  }
}

/**
 * Fans out the wires that arrive at the same port.
 *
 * A connector with no cavities of its own — a ring terminal, a splice — takes
 * every wire that comes to it at one point, and so does a cavity that more than
 * one row names. Drawn as they come, those wires lie exactly on top of each
 * other: two wires shown as one, which is the one thing a wiring diagram must
 * never do. They are spread across the height they have, in the order they
 * arrive from, so the fan does not cross itself on the way in.
 *
 * **Each side fans on its own**, and each fan is centred on the port. Wires
 * arriving on the left and wires leaving on the right never meet — they are at
 * opposite edges of the box — so spreading them as one set would only push both
 * groups off centre, and a splice fed by eight wires and leaving by one would
 * show the eight up one end of it and the one down the other.
 */
function spreadPorts(drafts: readonly Draft[]): void {
  interface End {
    draft: Draft;
    /** which end of the wire this is */
    near: "a" | "b";
    /** where the other end of it sits, which is the order to fan them in */
    from: number;
    box: SchemBox;
    pin: number;
  }

  const groups = new Map<string, End[]>();
  const add = (end: End, side: "left" | "right"): void => {
    const key = `${end.box.id}#${end.pin}#${side}`;
    const group = groups.get(key);
    if (group) group.push(end);
    else groups.set(key, [end]);
  };
  for (const draft of drafts) {
    const atA = draft.a.y + portOffset(draft.a, draft.wire.from.pin);
    const atB = draft.b.y + portOffset(draft.b, draft.wire.to.pin);
    add({ draft, near: "a", from: atB, box: draft.a, pin: draft.wire.from.pin }, draft.aSide);
    add({ draft, near: "b", from: atA, box: draft.b, pin: draft.wire.to.pin }, draft.bSide);
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    // a splice has the whole depth of its box to fan the wires across, where a
    // cavity has only the height of its own row
    const { box, pin } = group[0]!;
    const room =
      pin >= 0 ? PIN_H / 2 - 1 : box.pins.length ? HEAD_H / 2 - 3 : (box.h - HEAD_H - BOX_PAD) / 2 - 4;
    const step = Math.max(MIN_LANE - 1, Math.min(PORT_LANE, (room * 2) / (group.length - 1)));
    group.sort((p, q) => p.from - q.from);
    group.forEach((end, i) => {
      const shift = (i - (group.length - 1) / 2) * step;
      if (end.near === "a") end.draft.aShift = shift;
      else end.draft.bShift = shift;
    });
  }
}

/* ---------------- the model ---------------- */

/** Splits `C13.4` into connector and cavity; anything else is a connector alone. */
function endpointPort(endpoint: string, boxes: Map<string, SchemBox>): SchemPort | null {
  const name = endpointConnector(endpoint);
  if (!name) return null;
  const box = boxes.get(name);
  if (!box) return null;
  const cavity = DEST_RE.exec(endpoint.trim())?.[2];
  const pin = cavity ? box.pins.findIndex((p) => p.cavity === cavity) : -1;
  return { box: name, pin };
}

/** Builds the whole schematic from the document. */
export function buildSchematic(doc: HarnessDoc): Schematic {
  const boxes = buildBoxes(doc);
  const byName = new Map(boxes.map((b) => [b.id, b]));
  const routes = routeWires(doc);

  // a destination the drawing has no connector for still needs somewhere to
  // land, or the mistake would be invisible in the one view built to show it
  for (const { wire } of routes) {
    for (const endpoint of [wire.from, wire.to]) {
      const name = endpointConnector(endpoint);
      if (!name || byName.has(name)) continue;
      const box: SchemBox = {
        id: name,
        title: name,
        pins: [],
        x: 0,
        y: 0,
        w: MIN_W,
        h: boxHeight([]),
        unknown: true,
      };
      byName.set(name, box);
      boxes.push(box);
    }
  }

  // Both ends of every wire, found on the boxes before anything is laid out:
  // the arrangement is decided by what is wired to what, so it has to know.
  const pairs: ResolvedPair[] = [];
  for (const route of routes) {
    const from = endpointPort(route.wire.from, byName);
    const to = endpointPort(route.wire.to, byName);
    if (!from || !to) continue;
    const a = byName.get(from.box);
    const b = byName.get(to.box);
    if (!a || !b) continue;
    pairs.push({ route, from, to, a, b });
  }

  // the mated pairs, as boxes: the layout needs them before it places anything
  const byNode = new Map(boxes.filter((b) => b.nodeId).map((b) => [b.nodeId!, b]));
  const mates: [string, string][] = [];
  const paired = new Set<string>();
  for (const node of doc.nodes) {
    if (!node.mate || paired.has(node.id)) continue;
    const other = doc.nodes.find((n) => n.id === node.mate);
    if (!other || other.mate !== node.id) continue;
    paired.add(node.id);
    paired.add(other.id);
    const a = byNode.get(node.id);
    const b = byNode.get(other.id);
    if (a && b) mates.push([a.id, b.id]);
  }

  // a splice is as tall as the fan it has to show, which is only known once
  // both ends of every wire have been found
  const landings = new Map<string, number>();
  for (const pair of pairs) {
    for (const port of [pair.from, pair.to]) {
      if (port.pin >= 0) continue;
      landings.set(port.box, (landings.get(port.box) ?? 0) + 1);
    }
  }
  for (const box of boxes) {
    if (!box.pins.length) box.h = boxHeight([], landings.get(box.id) ?? 0);
  }

  // The whole schematic is arranged first, and only then does anything somebody
  // moved go where they put it. That order is the point: the arrangement is
  // worked out from what is wired to what, so a box left out of it changes
  // where every other box lands — and moving one connector would rearrange the
  // schematic around it. Its automatic place is simply given up, and the gap it
  // leaves stays where it was.
  autoLayout(doc, boxes, pairs, mates);
  for (const box of boxes) {
    const placed = doc.schematic?.[box.id];
    if (!placed) continue;
    box.placed = true;
    box.x = placed.x;
    box.y = placed.y;
  }

  const drafts: Draft[] = pairs.map(({ route, from, to, a, b }) => ({
    wire: {
      id: `${route.wire.from} ${route.wire.to}`,
      from,
      to,
      fromLabel: route.wire.from,
      toLabel: route.wire.to,
      func: route.wire.func,
      section: route.wire.section,
      color: route.wire.color,
      bands: colorsOf(route.wire.color),
      points: [],
      segments: [...route.path],
      unreachable: route.unreachable,
    },
    a,
    b,
    aShift: 0,
    bShift: 0,
    ...facing(a, b, from.pin, to.pin, boxes),
  }));

  spreadChannels(drafts);
  spreadPorts(drafts);
  const wires = drafts.map((draft) => {
    draft.wire.points = routeLine(draft);
    return draft.wire;
  });

  const joints = mates.map(([a, b]) => jointBetween(byName.get(a)!, byName.get(b)!));
  return { boxes, wires, joints, byName, bbox: boundsOf(boxes, wires) };
}

/**
 * Where the arrow between two mated connectors runs.
 *
 * Face to face when they stand side by side, which is how the layout puts them
 * and how a joint reads; one above the other when somebody has dragged them
 * that way, because an arrow that doubles back through both boxes says nothing.
 */
function jointBetween(a: SchemBox, b: SchemBox): SchemJoint {
  const [left, right] = a.x <= b.x ? [a, b] : [b, a];
  if (right.x - (left.x + left.w) >= 24) {
    return {
      a: left.id,
      b: right.id,
      from: { x: left.x + left.w, y: left.y + HEAD_H / 2 },
      to: { x: right.x, y: right.y + HEAD_H / 2 },
    };
  }
  const [over, under] = a.y <= b.y ? [a, b] : [b, a];
  return {
    a: over.id,
    b: under.id,
    from: { x: over.x + over.w / 2, y: over.y + over.h },
    to: { x: under.x + under.w / 2, y: under.y },
  };
}

/** Margin left round the schematic, in its own units. */
const MARGIN = 60;

function boundsOf(boxes: readonly SchemBox[], wires: readonly SchemWire[]): Rect {
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
  for (const box of boxes) {
    add(box.x, box.y);
    add(box.x + box.w, box.y + box.h);
  }
  for (const wire of wires) for (const p of wire.points) add(p.x, p.y);
  if (x1 > x2) return { x: 0, y: 0, w: 600, h: 400 };
  return { x: x1 - MARGIN, y: y1 - MARGIN, w: x2 - x1 + MARGIN * 2, h: y2 - y1 + MARGIN * 2 };
}

/* ---------------- the two views pointing at each other ---------------- */

/** What is lit in the schematic by whatever is selected on the sheet. */
export function schematicHighlight(
  model: Schematic,
  selection: Selection | null,
  doc: HarnessDoc,
): { boxes: Set<string>; wires: Set<string> } {
  const boxes = new Set<string>();
  const wires = new Set<string>();
  if (!selection) return { boxes, wires };

  if (selection.type === "node" || selection.type === "table") {
    const owns = (box: SchemBox): boolean =>
      selection.type === "node" ? box.nodeId === selection.id : box.tableId === selection.id;
    for (const box of model.boxes) if (owns(box)) boxes.add(box.id);
    // and everything wired to it: picking a connector is asking what it is
    // connected to, and an answer that leaves its own wires greyed out is the
    // wrong way round
    for (const wire of model.wires) {
      if (boxes.has(wire.from.box) || boxes.has(wire.to.box)) wires.add(wire.id);
    }
  } else {
    // a branch, or a label sitting on one: every wire that runs through it
    const seg =
      selection.type === "segment"
        ? selection.id
        : (doc.inlines.find((i) => i.id === selection.id)?.seg ?? "");
    if (seg) {
      for (const wire of model.wires) {
        if (!wire.segments.includes(seg)) continue;
        wires.add(wire.id);
        boxes.add(wire.from.box);
        boxes.add(wire.to.box);
      }
    }
  }
  return { boxes, wires };
}

/** What is lit on the sheet by a wire picked in the schematic. */
export function boardHighlight(
  model: Schematic,
  wireId: string | null,
): { nodes: Set<string>; segments: Set<string> } {
  const nodes = new Set<string>();
  const segments = new Set<string>();
  const wire = wireId ? model.wires.find((w) => w.id === wireId) : undefined;
  if (!wire) return { nodes, segments };
  for (const seg of wire.segments) segments.add(seg);
  for (const port of [wire.from, wire.to]) {
    const node = model.byName.get(port.box)?.nodeId;
    if (node) nodes.add(node);
  }
  return { nodes, segments };
}
