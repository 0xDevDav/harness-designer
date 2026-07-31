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
