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
  /**
   * A mated pair lies on the way, so what the two tables describe is not one
   * wire but two, one each side of it. They may be different colours and
   * different sections, and neither the checks nor the drawing may treat the
   * two ends as descriptions of the same piece of wire.
   */
  jointed: boolean;
}

interface Link {
  seg: string;
  to: string;
}

/**
 * Adjacency list over node ids. Built once per routing pass.
 *
 * A mated pair is a step in this graph with no branch behind it: the two
 * connectors plug together, so a circuit written straight through the joint can
 * be built, and saying it cannot would be wrong. It carries no segment id
 * because it is not a branch — nothing is cut to its length and nothing is
 * drawn along it — and everything that walks a route has to be ready for the
 * gap where a branch would otherwise be.
 */
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
  for (const n of doc.nodes) {
    if (n.mate && doc.nodes.some((o) => o.id === n.mate && o.mate === n.id)) add(n.id, JOINT, n.mate);
  }
  return graph;
}

/** Stands in for the branch a joint does not have. */
export const JOINT = "";

/**
 * Shortest chain of branches between two nodes, as segment ids, or `null` when
 * they are not joined.
 *
 * Fewest hops rather than shortest length: a harness is a tree, so there is
 * only ever one route and the choice does not arise. It matters only in the
 * malformed case of a loop, where fewest hops at least keeps the answer
 * deterministic instead of depending on the order segments were drawn in.
 *
 * A joint crossed on the way leaves no id in the list, because it is not a
 * branch. What comes back is the branches on one side followed by the branches
 * on the other, and the seam between them is found again by asking the nodes:
 * that is what `pathNodes` does, and what anything walking a route must do.
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
        for (let at = to; at !== from;) {
          const step = cameFrom.get(at)!;
          if (step.seg !== JOINT) path.push(step.seg);
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
 * Where a route steps from one branch to the next without a node in common:
 * it crossed a joint there.
 *
 * The path holds no id for the joint, because a joint is not a branch, so the
 * seam is found by asking the geometry instead — the branch it lands on does
 * not touch the node it left, and the two nodes are mated.
 */
function jumpsJoint(doc: HarnessDoc, from: string, path: readonly string[]): boolean {
  let at = from;
  for (const id of path) {
    const seg = doc.segments.find((s) => s.id === id);
    if (!seg) return false;
    if (seg.a !== at && seg.b !== at) {
      const mate = doc.nodes.find((n) => n.id === at)?.mate;
      if (!mate || (seg.a !== mate && seg.b !== mate)) return false;
      return true;
    }
    at = seg.a === at ? seg.b : seg.a;
  }
  return false;
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
    const idle = { wire, path: [] as string[], lengthMm: null, unreachable: false, jointed: false };
    if (!a || !b) return idle;
    if (!attached.has(a.id) || !attached.has(b.id)) return idle;

    const path = findPath(doc, a.id, b.id);
    if (!path) return { wire, path: [], lengthMm: null, unreachable: true, jointed: false };
    // A circuit written straight through a joint is two wires, one each side,
    // and the branches on both sides added together are not the length of
    // either. There is no single figure to cut to, so there is none to give:
    // an unknown length has to stay visibly unknown.
    const jointed = jumpsJoint(doc, a.id, path);
    return {
      wire,
      path,
      lengthMm: jointed ? null : pathLengthMm(doc, path),
      unreachable: false,
      jointed,
    };
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
  return routeWires(doc).map(({ wire, lengthMm }) => (lengthMm === null ? wire : { ...wire, lengthMm }));
}

/**
 * Nodes a wire passes through, ends included. Used by the drawing.
 *
 * A branch that does not touch the node the walk is standing on is the far side
 * of a joint, and the walk steps across to the mate to carry on — the joint
 * itself leaves no id in the path, so this is where it is found again.
 */
export function pathNodes(doc: HarnessDoc, from: string, path: readonly string[]): string[] {
  const nodes = [from];
  let at = from;
  for (const id of path) {
    const seg = doc.segments.find((s) => s.id === id);
    if (!seg) break;
    if (seg.a !== at && seg.b !== at) {
      const mate = doc.nodes.find((n) => n.id === at)?.mate;
      if (!mate || (seg.a !== mate && seg.b !== mate)) break;
      at = mate;
      nodes.push(at);
    }
    at = seg.a === at ? seg.b : seg.a;
    nodes.push(at);
  }
  return nodes;
}
