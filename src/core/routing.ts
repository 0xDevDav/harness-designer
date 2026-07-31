/**
 * Where each wire physically runs.
 *
 * The document already holds both halves of the answer without knowing it: the
 * segments say which branches join which nodes, and the cavity tables say which
 * cavity goes to which cavity. What was missing is the road between the two,
 * and it is derived rather than stored, so no file has to change and an old
 * `.json` gains the feature the moment it is opened.
 */

import { parseLengthMm } from "./length";
import { buildWireList } from "./wirelist";
import type { HarnessDoc, HNode, WireRow } from "./types";

/** One wire and the branches it runs through. */
export interface RoutedWire {
  wire: WireRow;
  /** segment ids in order, from the `from` end to the `to` end */
  path: string[];
  /** total cut length in millimetres; `null` if any branch on the way lacks a readable length */
  lengthMm: number | null;
  /**
   * The two ends exist but no chain of branches joins them, so the wire the
   * table describes cannot be built. Distinct from an end that does not exist
   * at all, which the cross-reference rule already reports.
   */
  unreachable: boolean;
}

interface Link {
  seg: string;
  to: string;
}

/** Adjacency list over node ids. Built once per routing pass. */
function adjacency(doc: HarnessDoc): Map<string, Link[]> {
  const graph = new Map<string, Link[]>();
  const add = (from: string, seg: string, to: string): void => {
    const links = graph.get(from);
    if (links) links.push({ seg, to });
    else graph.set(from, [{ seg, to }]);
  };
  for (const s of doc.segments) {
    add(s.a, s.id, s.b);
    add(s.b, s.id, s.a);
  }
  return graph;
}

/**
 * Shortest chain of branches between two nodes, as segment ids, or `null` when
 * they are not joined.
 *
 * Fewest hops rather than shortest length: a harness is a tree, so there is
 * only ever one route and the choice does not arise. It matters only in the
 * malformed case of a loop, where fewest hops at least keeps the answer
 * deterministic instead of depending on the order segments were drawn in.
 */
export function findPath(doc: HarnessDoc, from: string, to: string): string[] | null {
  if (from === to) return [];
  const graph = adjacency(doc);
  const cameFrom = new Map<string, { node: string; seg: string }>();
  const seen = new Set<string>([from]);
  const queue: string[] = [from];

  for (let head = 0; head < queue.length; head++) {
    const node = queue[head]!;
    for (const link of graph.get(node) ?? []) {
      if (seen.has(link.to)) continue;
      seen.add(link.to);
      cameFrom.set(link.to, { node, seg: link.seg });
      if (link.to === to) {
        const path: string[] = [];
        for (let at = to; at !== from; ) {
          const step = cameFrom.get(at)!;
          path.push(step.seg);
          at = step.node;
        }
        return path.reverse();
      }
      queue.push(link.to);
    }
  }
  return null;
}

/** Nodes that carry a name, indexed by it. A junction keeps its name when a
 * branch is drawn through what used to be a connector, so the lookup cannot
 * filter on `kind`. */
export function namedNodes(doc: HarnessDoc): Map<string, HNode> {
  const byName = new Map<string, HNode>();
  for (const n of doc.nodes) {
    const name = n.name.trim();
    if (name && !byName.has(name)) byName.set(name, n);
  }
  return byName;
}

/**
 * The connector an endpoint names.
 *
 * `C3.7` is only the tidiest of the spellings a real drawing uses. A ring
 * terminal has no cavity to number, so it is written `W1` on its own; a feed is
 * annotated `B+ (FUS 15A)`; a wire reaching a ring through a splice is written
 * `S1 → W1`, and its own cut length ends at the splice, which is the first name
 * on the line. So the rule is the leading name token, and the `C3.7` form is
 * just the case where that token is followed by a cavity.
 */
export const endpointConnector = (endpoint: string): string =>
  /^\s*([A-Za-z0-9_+-]+)/.exec(endpoint)?.[1] ?? "";

/** Sum of the branch lengths along a path, or `null` if any of them is unreadable. */
export function pathLengthMm(doc: HarnessDoc, path: readonly string[]): number | null {
  let total = 0;
  for (const id of path) {
    const seg = doc.segments.find((s) => s.id === id);
    const mm = parseLengthMm(seg?.len);
    if (mm === null) return null;
    total += mm;
  }
  return total;
}

/**
 * Every wire in the list with the branches it runs through.
 *
 * Two cases deliberately come back as `unreachable: false` with an empty path,
 * because calling them wire faults would be wrong:
 *
 * - an end that is not a node in the drawing at all, which the cross-reference
 *   rule already reports, and saying it twice would be noise;
 * - an end with no branch attached to it, which means the harness has not been
 *   drawn yet rather than drawn wrong. Filling in the pin-outs first and
 *   routing afterwards is a normal way to work, and a checker that shouts
 *   through the whole first half of the job gets switched off.
 */
export function routeWires(doc: HarnessDoc): RoutedWire[] {
  const byName = namedNodes(doc);
  const attached = new Set<string>();
  for (const s of doc.segments) {
    attached.add(s.a);
    attached.add(s.b);
  }

  return buildWireList(doc).map((wire) => {
    const a = byName.get(endpointConnector(wire.from));
    const b = byName.get(endpointConnector(wire.to));
    const idle = { wire, path: [] as string[], lengthMm: null, unreachable: false };
    if (!a || !b) return idle;
    if (!attached.has(a.id) || !attached.has(b.id)) return idle;

    const path = findPath(doc, a.id, b.id);
    if (!path) return { wire, path: [], lengthMm: null, unreachable: true };
    return { wire, path, lengthMm: pathLengthMm(doc, path), unreachable: false };
  });
}

/**
 * How many wires run through each branch.
 *
 * This is what makes the drawing honest: today a branch carrying two wires is
 * drawn exactly as thick as one carrying forty.
 */
export function segmentLoad(routes: readonly RoutedWire[]): Map<string, number> {
  const load = new Map<string, number>();
  for (const route of routes) {
    for (const seg of route.path) load.set(seg, (load.get(seg) ?? 0) + 1);
  }
  return load;
}

/** Wire list rows carrying their computed cut length. */
export function wireRowsWithLength(doc: HarnessDoc): WireRow[] {
  return routeWires(doc).map(({ wire, lengthMm }) =>
    lengthMm === null ? wire : { ...wire, lengthMm },
  );
}

/** Nodes a wire passes through, ends included. Used by the drawing. */
export function pathNodes(doc: HarnessDoc, from: string, path: readonly string[]): string[] {
  const nodes = [from];
  let at = from;
  for (const id of path) {
    const seg = doc.segments.find((s) => s.id === id);
    if (!seg) break;
    at = seg.a === at ? seg.b : seg.a;
    nodes.push(at);
  }
  return nodes;
}
