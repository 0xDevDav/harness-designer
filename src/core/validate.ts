import { cavityTables, cell, findNode, nodeForTable, resolveDest } from "./doc";
import type { CavityTable } from "./doc";
import { routeWires } from "./routing";
import { checkWireEnds } from "./wireends";
import { wireColorKey } from "./colors";
import type { HarnessDoc, Issue } from "./types";
import type { Translate } from "@/i18n";

export interface ValidationContext {
  doc: HarnessDoc;
  t: Translate;
  /** cavity tables already recognized, so every rule does not redo the work */
  tables: CavityTable[];
  /** cavity tables indexed by connector name */
  byOwner: Map<string, CavityTable>;
  /**
   * Pairs of cavities the drawing joins through a mated pair, as `A.1|B.2` with
   * the two ends in the order they sort. What those two rows describe is two
   * wires and not one, so nothing may compare them as if they were one piece.
   */
  jointed: Set<string>;
}

export interface ValidationRule {
  id: string;
  run(ctx: ValidationContext): Issue[];
}

/* ---------------- built-in rules ---------------- */

/** `[n]` references with no matching row in the Notes table. */
const noteReferences: ValidationRule = {
  id: "note-references",
  run({ doc, t }) {
    const issues: Issue[] = [];
    const notesTable = doc.tables.find(
      (tb) => tb.kind === "table" && /^(note|notes)\b/i.test(tb.title ?? ""),
    );
    if (!notesTable) return issues;
    const known = new Set(notesTable.rows.map((r) => String(r[0] ?? "").trim()));

    const check = (refs: string, what: string, target: Issue["target"]): void => {
      for (const num of refs.match(/\d+/g) ?? []) {
        if (!known.has(num)) {
          issues.push({
            rule: "note-references",
            severity: "error",
            message: t("validate.noteMissing", { what, num }),
            ...(target ? { target } : {}),
          });
        }
      }
    };

    for (const n of doc.nodes) {
      if (!n.refs) continue;
      check(n.refs, t("validate.nodeLabel", { name: n.name || t("validate.nodeUnnamed") }), {
        type: "node",
        id: n.id,
      });
    }
    for (const s of doc.segments) {
      if (!s.refs) continue;
      check(s.refs, t("validate.segmentLabel", { len: s.len }), { type: "segment", id: s.id });
    }
    return issues;
  },
};

/** Two cavity tables claiming the same connector. */
const duplicateTables: ValidationRule = {
  id: "duplicate-tables",
  run({ tables, t }) {
    const issues: Issue[] = [];
    const seen = new Set<string>();
    for (const { table, owner } of tables) {
      if (seen.has(owner)) {
        issues.push({
          rule: "duplicate-tables",
          severity: "error",
          message: t("validate.duplicateTable", { owner }),
          target: { type: "table", id: table.id },
        });
      }
      seen.add(owner);
    }
    return issues;
  },
};

/**
 * A cavity repeated within the same table.
 *
 * Repeating a cavity is not always a mistake: one pin can carry two wires
 * (double crimp, or a jumper to two destinations). So a repeat is an **error**
 * only when the rows are indistinguishable, meaning the same destination or
 * none at all, and a **warning** when each one goes somewhere different.
 */
const duplicateCavities: ValidationRule = {
  id: "duplicate-cavities",
  run({ tables, t }) {
    const issues: Issue[] = [];
    for (const { table, cols, owner } of tables) {
      const byCavity = new Map<string, string[]>();
      for (const row of table.rows) {
        const cavity = cell(row, cols.cavity);
        if (!cavity) continue;
        const dest = resolveDest(row, cols);
        const key = dest ? `${dest.connector}.${dest.cavity}` : "";
        const list = byCavity.get(cavity) ?? [];
        list.push(key);
        byCavity.set(cavity, list);
      }

      for (const [cavity, dests] of byCavity) {
        if (dests.length < 2) continue;
        const distinct = new Set(dests.filter(Boolean));
        const allDistinct = distinct.size === dests.length;
        issues.push({
          rule: "duplicate-cavities",
          severity: allDistinct ? "warning" : "error",
          message: t(allDistinct ? "validate.multiWireCavity" : "validate.duplicateCavity", {
            owner,
            cavity,
            n: dests.length,
          }),
          target: { type: "table", id: table.id },
        });
      }
    }
    return issues;
  },
};

/**
 * Cross-references between tables: destination that does not exist, missing
 * cavity, mismatched cross-reference, one-way reference, and wire properties
 * that disagree between the two ends.
 */
const crossReferences: ValidationRule = {
  id: "cross-references",
  run({ doc, t, tables, byOwner, jointed }) {
    const issues: Issue[] = [];
    for (const { table, cols, owner } of tables) {
      for (const row of table.rows) {
        const cavity = cell(row, cols.cavity);
        if (!cavity) continue;
        const resolved = resolveDest(row, cols);
        if (!resolved) continue;
        const targetName = resolved.connector;
        const targetCavity = resolved.cavity;
        const dest = `${targetName}.${targetCavity}`;
        const from = `${owner}.${cavity}`;

        const target = byOwner.get(targetName);
        if (!target) {
          // the connector may exist in the drawing without a cavity table
          if (!doc.nodes.some((n) => n.name === targetName)) {
            issues.push({
              rule: "cross-references",
              severity: "error",
              message: t("validate.unknownTarget", { from, dest, name: targetName }),
              target: { type: "table", id: table.id },
            });
          }
          continue;
        }

        const targetRow = target.table.rows.find((r) => cell(r, target.cols.cavity) === targetCavity);
        if (!targetRow) {
          issues.push({
            rule: "cross-references",
            severity: "error",
            message: t("validate.missingCavity", {
              from,
              dest,
              cavity: targetCavity,
              owner: target.owner,
            }),
            target: { type: "table", id: target.table.id },
          });
          continue;
        }

        const back = cell(targetRow, target.cols.dest);
        const bm = resolveDest(targetRow, target.cols);
        if (!back) {
          issues.push({
            rule: "cross-references",
            severity: "warning",
            message: t("validate.oneWay", { from, dest }),
            target: { type: "table", id: target.table.id },
          });
        } else if (bm && (bm.connector !== owner || bm.cavity !== cavity)) {
          issues.push({
            rule: "cross-references",
            severity: "error",
            message: t("validate.crossMismatch", { from, dest, back: `${bm.connector}.${bm.cavity}` }),
            target: { type: "table", id: target.table.id },
          });
          continue;
        }

        // same wire seen from both ends: colour and section have to agree
        const here = { color: cell(row, cols.color), section: cell(row, cols.section) };
        const there = {
          color: cell(targetRow, target.cols.color),
          section: cell(targetRow, target.cols.section),
        };
        // the two ends may have been written in different languages or codes
        // ("bianco/giallo" and "WS/GE" are the same wire), so the comparison
        // runs on resolved colours and falls back to text only for non-colours
        const same = (a: string, b: string): boolean => {
          const ka = wireColorKey(a);
          const kb = wireColorKey(b);
          if (ka && kb) return ka === kb;
          return a.toLowerCase().replace(/\s+/g, "") === b.toLowerCase().replace(/\s+/g, "");
        };
        // Compared once per wire, from the alphabetically lower end — and not
        // at all when a joint lies between the two. There the tables describe
        // two wires, one each side of it, and two wires meeting at a joint are
        // very often two different colours: that is what a joint is for.
        if (from < dest && !jointed.has([from, dest].sort().join("|"))) {
          if (here.color && there.color && !same(here.color, there.color)) {
            issues.push({
              rule: "cross-references",
              severity: "warning",
              message: t("validate.colorMismatch", { from, dest, a: here.color, b: there.color }),
              target: { type: "table", id: table.id },
            });
          }
          if (here.section && there.section && !same(here.section, there.section)) {
            issues.push({
              rule: "cross-references",
              severity: "warning",
              message: t("validate.sectionMismatch", { from, dest, a: here.section, b: there.section }),
              target: { type: "table", id: table.id },
            });
          }
        }
      }
    }
    return issues;
  },
};

/** Drawing hygiene: unnamed connectors, tables with no connector. */
const drawingHygiene: ValidationRule = {
  id: "drawing-hygiene",
  run({ doc, t }) {
    const issues: Issue[] = [];
    for (const n of doc.nodes) {
      if (n.kind === "connector" && n.style !== "none" && !n.name.trim()) {
        issues.push({
          rule: "drawing-hygiene",
          severity: "warning",
          message: t("validate.unnamedConnector"),
          target: { type: "node", id: n.id },
        });
      }
    }
    for (const table of doc.tables) {
      if (table.kind !== "table") continue;
      if (table.node && !findNode(doc, table.node)) continue;
      const looksLikeCavityTable = /cavit|cavity|pin/i.test((table.head ?? []).join(" "));
      if (looksLikeCavityTable && !nodeForTable(doc, table)) {
        issues.push({
          rule: "drawing-hygiene",
          severity: "warning",
          message: t("validate.tableWithoutNode", { title: table.title ?? "" }),
          target: { type: "table", id: table.id },
        });
      }
    }
    return issues;
  },
};

/**
 * Two-ends rule: the same colour in three or more connectors is a physical
 * wiring mistake. Plain black is exempt, because it is ground.
 */
const wireEnds: ValidationRule = {
  id: "wire-ends",
  run({ doc, t }) {
    return checkWireEnds(doc).conflicts.map((conflict) => ({
      rule: "wire-ends",
      severity: "error" as const,
      message: t("validate.wireTooManyEnds", {
        color: conflict.label,
        n: conflict.owners.length,
        list: conflict.owners.join(", "),
      }),
      ...(conflict.rows[0] ? { target: { type: "table" as const, id: conflict.rows[0].tableId } } : {}),
    }));
  },
};

/**
 * A wire the tables describe but the drawing cannot carry: both connectors
 * exist, and no chain of branches joins them.
 *
 * The other rules compare tables against tables. This one is the first to check
 * the tables against the drawing, which is where the mistake usually hides: a
 * pin-out gets filled in for a connector whose branch was never drawn, and
 * everything reads as consistent because the two tables agree with each other.
 */
const wireRouting: ValidationRule = {
  id: "wire-routing",
  run({ doc, t }) {
    const issues: Issue[] = [];
    for (const route of routeWires(doc)) {
      if (!route.unreachable) continue;
      issues.push({
        rule: "wire-routing",
        severity: "error",
        message: t("validate.wireUnreachable", { from: route.wire.from, to: route.wire.to }),
      });
    }
    return issues;
  },
};

/**
 * A joint whose two sides do not line up.
 *
 * Cavity 3 of one half of a mated pair is cavity 3 of the other: they are one
 * point, wired from either side by two different wires that may well be two
 * different colours. That is the whole reason the pairing exists, and it is
 * also the thing nobody notices going wrong — a circuit wired up to the joint
 * and left dead on the far side looks complete from both tables, because each
 * table is complete on its own terms.
 *
 * A warning rather than an error: a joint is a normal place for a circuit to
 * stop, and a connector half filled while the drawing is being built is not a
 * fault yet.
 */
const jointCavities: ValidationRule = {
  id: "joint-cavities",
  run({ doc, t, byOwner }) {
    const issues: Issue[] = [];
    const done = new Set<string>();

    /** Cavities of a connector that actually go somewhere. */
    const live = (owner: string): Set<string> => {
      const ct = byOwner.get(owner);
      const out = new Set<string>();
      if (!ct) return out;
      for (const row of ct.table.rows) {
        const cavity = cell(row, ct.cols.cavity);
        if (cavity && resolveDest(row, ct.cols)) out.add(cavity);
      }
      return out;
    };

    for (const node of doc.nodes) {
      const other = node.mate ? findNode(doc, node.mate) : undefined;
      if (!other || done.has(node.id)) continue;
      done.add(node.id);
      done.add(other.id);
      if (!node.name || !other.name) continue;
      if (!byOwner.has(node.name) || !byOwner.has(other.name)) continue;

      const here = live(node.name);
      const there = live(other.name);
      for (const [from, to, gap] of [
        [node, other, [...here].filter((c) => !there.has(c))],
        [other, node, [...there].filter((c) => !here.has(c))],
      ] as const) {
        if (!gap.length) continue;
        issues.push({
          rule: "joint-cavities",
          severity: "warning",
          message: t("validate.jointGap", {
            from: from.name,
            to: to.name,
            cavities: gap.join(", "),
          }),
          target: { type: "node", id: to.id },
        });
      }
    }
    return issues;
  },
};

export const builtinRules: ValidationRule[] = [
  noteReferences,
  duplicateTables,
  duplicateCavities,
  crossReferences,
  wireEnds,
  wireRouting,
  jointCavities,
  drawingHygiene,
];

/* ---------------- extensible registry ---------------- */

const extraRules = new Map<string, ValidationRule>();

/** Adds a validation rule (plugin API). Returns the function that removes it. */
export function registerRule(rule: ValidationRule): () => void {
  extraRules.set(rule.id, rule);
  return () => extraRules.delete(rule.id);
}

export function allRules(): ValidationRule[] {
  return [...builtinRules, ...extraRules.values()];
}

/** Runs every rule. A faulty rule must never stop the others. */
export function validateDoc(doc: HarnessDoc, t: Translate): Issue[] {
  const tables = cavityTables(doc);
  const byOwner = new Map<string, CavityTable>();
  for (const ct of tables) if (!byOwner.has(ct.owner)) byOwner.set(ct.owner, ct);
  // worked out once: every rule that has to know asks the same question
  const jointed = new Set<string>();
  for (const route of routeWires(doc)) {
    if (route.jointed) jointed.add([route.wire.from, route.wire.to].sort().join("|"));
  }
  const ctx: ValidationContext = { doc, t, tables, byOwner, jointed };

  const issues: Issue[] = [];
  for (const rule of allRules()) {
    try {
      issues.push(...rule.run(ctx));
    } catch (err) {
      console.error(`[harness] validation rule "${rule.id}" threw`, err);
    }
  }
  // errors first, then warnings, keeping the order they were found in
  return issues.sort((a, b) => Number(a.severity === "warning") - Number(b.severity === "warning"));
}
