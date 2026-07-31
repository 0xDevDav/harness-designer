/**
 * Data model. Single source of truth for the whole application: it is at once
 * the `.json` file format, the autosave payload and the undo snapshot. It must
 * stay serializable with `JSON.stringify`.
 */

/** Format version. Documents without the field are accepted as they are. */
export const DOC_VERSION = 1;

export type NodeKind = "junction" | "connector";

/**
 * Termination style. The five built-in values are listed, but plugins may
 * register their own, which is why the type stays open to any string.
 */
export type ConnectorStyle = "plug" | "ring" | "faston" | "pin" | "splice" | "none" | (string & {});

export interface HNode {
  id: string;
  x: number;
  y: number;
  kind: NodeKind;
  /** Connector name (C1, P1, W1…). Empty for junctions. */
  name: string;
  style: ConnectorStyle;
  /** Note references, e.g. "[1, 5]". */
  refs: string;
  /**
   * The connector this one mates with, if any. Always reciprocal: the other
   * node names this one back, and `normalizeDoc` drops a link that does not.
   *
   * A mated pair is a joint in the harness, not a wire. Cavity 3 of one is
   * cavity 3 of the other, and the wire arriving at the joint and the wire
   * leaving it are two different wires that may well be two different colours.
   */
  mate?: string;
  /**
   * The way the connector points, when it has been said rather than worked out.
   *
   * Absent, it faces along the branch attached to it, which is right almost
   * always and is what every drawing made before this did. Set, it faces where
   * it was told: the symbol turns, its name follows, and in a square drawing
   * the cable leaves it along that axis.
   */
  facing?: "right" | "left" | "up" | "down";
}

export interface Segment {
  id: string;
  /** id of the start node */
  a: string;
  /** id of the end node */
  b: string;
  /** Length as free text, e.g. "600 mm". */
  len: string;
  refs: string;
  /**
   * Points the branch bends through on its way from `a` to `b`, in order.
   *
   * Absent, which is the usual case, the branch is left to find its own way:
   * straight, or squared off automatically when the drawing is drawn square.
   * Present, it goes exactly this way and nothing rearranges it.
   *
   * A bend is not a node: nothing joins there, no wire ends there and it
   * carries no name — it only says the cable turns. Making it a node instead
   * would put a junction into the routing graph that no wire ever leaves by,
   * and every count of branches in the drawing would go wrong.
   */
  points?: Point[];
  /**
   * Turns an automatic corner the other way: across then along, rather than
   * along then across. Only ever consulted on a branch that has no bends of its
   * own in a drawing that is square.
   */
  flip?: boolean;
}

export interface Inline {
  id: string;
  /** id of the segment the label sits on */
  seg: string;
  /** parametric position along the segment, within [T_MIN, T_MAX] */
  t: number;
  text: string;
  color: string;
}

export type TableKind = "table" | "title";

export interface Table {
  id: string;
  x: number;
  y: number;
  kind: TableKind;
  title?: string;
  head?: string[];
  rows: string[][];
  /** id of the connector this cavity table belongs to. */
  node?: string;
  /**
   * Automatic mutual linking. While enabled (the default, i.e. field absent),
   * filling in a destination here also fills the matching cavity in the table
   * at the other end. Disabling it isolates the table: it writes to no other
   * connector and no other connector writes to it.
   */
  autoLink?: boolean;
}

export interface DocMeta {
  title: string;
  description: string;
  partNumber: string;
  revision: string;
  company: string;
  drawnBy: string;
  date: string;
}

export interface HarnessDoc {
  version: number;
  meta: DocMeta;
  nodes: HNode[];
  segments: Segment[];
  inlines: Inline[];
  tables: Table[];
  /**
   * Every branch runs horizontally or vertically, cornering by itself wherever
   * its two ends do not line up.
   *
   * A property of the drawing and not a setting of the program: it decides the
   * shape of what is on the sheet, so it is saved with it, it is undoable, and
   * a drawing already laid out on the diagonal keeps its layout when opened
   * rather than being squared off underneath the person who drew it.
   */
  square?: boolean;
}

export type EntityType = "node" | "segment" | "inline" | "table";

export interface Selection {
  type: EntityType;
  id: string;
}

export interface Viewport {
  x: number;
  y: number;
  /** scale factor */
  k: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A problem reported by the consistency check. */
export interface Issue {
  /** id of the rule that produced it (useful to plugins) */
  rule: string;
  severity: "error" | "warning";
  message: string;
  /** element to select when the problem is clicked */
  target?: Selection;
}

/** One row of the wire list. */
export interface WireRow {
  index: number;
  from: string;
  to: string;
  func: string;
  color: string;
  section: string;
  /**
   * Cut length in millimetres, summed over the branches the wire runs through.
   * Absent when the route is unknown or any branch on the way carries no
   * readable length: an unknown length has to stay visibly unknown, because a
   * wire cut to a guessed figure is scrap.
   */
  lengthMm?: number;
}
