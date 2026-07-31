import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeDoc } from "@/core/doc";
import { sampleDoc } from "@/core/sample";
import { allRules, registerRule, validateDoc } from "@/core/validate";
import type { ValidationRule } from "@/core/validate";
import type { HarnessDoc, Issue } from "@/core/types";
import type { Translate } from "@/i18n";

/** Fake translation returning the key, so the tests talk about rules and not about wording. */
const t: Translate = (key) => String(key);

const CAV_HEAD = ["Cavità", "Verso", "Colore", "Sezione"];

interface TableSpec {
  id: string;
  node: string;
  title: string;
  rows: string[][];
}

/** Document with connectors and their cavity tables, and no branches. */
function docWith(names: string[], tables: TableSpec[]): HarnessDoc {
  return normalizeDoc({
    nodes: names.map((name, i) => ({
      id: name.toLowerCase(),
      x: i * 100,
      y: 0,
      kind: "connector",
      name,
      style: "plug",
      refs: "",
    })),
    tables: tables.map((s) => ({
      id: s.id,
      node: s.node,
      x: 0,
      y: 0,
      kind: "table",
      title: s.title,
      head: CAV_HEAD,
      rows: s.rows,
    })),
  });
}

const rules = (issues: Issue[]): string[] => issues.map((i) => i.rule);
const messages = (issues: Issue[]): string[] => issues.map((i) => i.message);
const errors = (issues: Issue[]): Issue[] => issues.filter((i) => i.severity === "error");
const warnings = (issues: Issue[]): Issue[] => issues.filter((i) => i.severity === "warning");

describe("sample document", () => {
  it("holds no consistency errors", () => {
    const issues = validateDoc(sampleDoc(t), t);
    expect(errors(issues)).toEqual([]);
  });

  it("errors come before warnings in the report", () => {
    // table A produces a warning, a colour mismatch, before C produces an error
    const doc = docWith(
      ["A", "B", "C"],
      [
        { id: "ta", node: "a", title: "A", rows: [["1", "B.1", "rosso", "1.5"]] },
        { id: "tb", node: "b", title: "B", rows: [["1", "A.1", "nero", "1.5"]] },
        { id: "tc", node: "c", title: "C", rows: [["1", "Z.1", "rosso", "1.5"]] },
      ],
    );
    const issues = validateDoc(doc, t);
    expect(issues.map((i) => i.severity)).toEqual(["error", "warning"]);
    expect(messages(issues)).toEqual(["validate.unknownTarget", "validate.colorMismatch"]);
  });
});

describe("cross-references between tables", () => {
  it("reports a cross-reference that does not add up", () => {
    const doc = docWith(
      ["A", "B"],
      [
        { id: "ta", node: "a", title: "A", rows: [["1", "B.1", "rosso", "1.5"]] },
        { id: "tb", node: "b", title: "B", rows: [["1", "A.2", "rosso", "1.5"]] },
      ],
    );
    const issues = validateDoc(doc, t);
    expect(messages(errors(issues))).toContain("validate.crossMismatch");
  });

  it("reports a destination that does not exist in the drawing", () => {
    const doc = docWith(["A"], [{ id: "ta", node: "a", title: "A", rows: [["1", "Z.1", "rosso", "1.5"]] }]);
    const issues = validateDoc(doc, t);
    expect(messages(errors(issues))).toContain("validate.unknownTarget");
  });

  it("accepts a connector present in the drawing but with no table", () => {
    const doc = docWith(
      ["A", "Z"],
      [{ id: "ta", node: "a", title: "A", rows: [["1", "Z.1", "rosso", "1.5"]] }],
    );
    expect(errors(validateDoc(doc, t))).toEqual([]);
  });

  it("reports a cavity missing from the destination table", () => {
    const doc = docWith(
      ["A", "B"],
      [
        { id: "ta", node: "a", title: "A", rows: [["1", "B.5", "rosso", "1.5"]] },
        { id: "tb", node: "b", title: "B", rows: [["1", "A.1", "rosso", "1.5"]] },
      ],
    );
    expect(messages(errors(validateDoc(doc, t)))).toContain("validate.missingCavity");
  });

  it("warns when the reference is one-way", () => {
    const doc = docWith(
      ["A", "B"],
      [
        { id: "ta", node: "a", title: "A", rows: [["1", "B.1", "rosso", "1.5"]] },
        { id: "tb", node: "b", title: "B", rows: [["1", "", "rosso", "1.5"]] },
      ],
    );
    const issues = validateDoc(doc, t);
    expect(errors(issues)).toEqual([]);
    expect(messages(warnings(issues))).toContain("validate.oneWay");
  });

  it("warns when the two ends declare different colours", () => {
    const doc = docWith(
      ["A", "B"],
      [
        { id: "ta", node: "a", title: "A", rows: [["1", "B.1", "rosso", "1.5"]] },
        { id: "tb", node: "b", title: "B", rows: [["1", "A.1", "nero", "1.5"]] },
      ],
    );
    const issues = validateDoc(doc, t);
    expect(errors(issues)).toEqual([]);
    const colore = warnings(issues).filter((i) => i.message === "validate.colorMismatch");
    // the comparison happens once, from the alphabetically lower end
    expect(colore).toHaveLength(1);
    expect(colore[0]?.target).toEqual({ type: "table", id: "ta" });
  });

  it("warns when the two ends declare different sections", () => {
    const doc = docWith(
      ["A", "B"],
      [
        { id: "ta", node: "a", title: "A", rows: [["1", "B.1", "rosso", "1.5 mm²"]] },
        { id: "tb", node: "b", title: "B", rows: [["1", "A.1", "rosso", "2.5 mm²"]] },
      ],
    );
    const issues = validateDoc(doc, t);
    expect(messages(warnings(issues))).toContain("validate.sectionMismatch");
  });

  it("tolerates differences of spacing and case between the two ends", () => {
    const doc = docWith(
      ["A", "B"],
      [
        { id: "ta", node: "a", title: "A", rows: [["1", "B.1", "Rosso", "1.5 mm²"]] },
        { id: "tb", node: "b", title: "B", rows: [["1", "A.1", "rosso", "1.5  mm²"]] },
      ],
    );
    expect(validateDoc(doc, t)).toEqual([]);
  });
});

describe("duplicate cavities", () => {
  it("reports the same cavity repeated in the table", () => {
    const doc = docWith(
      ["A"],
      [
        {
          id: "ta",
          node: "a",
          title: "A",
          rows: [
            ["1", "", "rosso", "1.5"],
            ["1", "", "nero", "1.5"],
            ["2", "", "blu", "1.5"],
          ],
        },
      ],
    );
    const issues = validateDoc(doc, t);
    expect(messages(errors(issues))).toEqual(["validate.duplicateCavity"]);
    expect(errors(issues)[0]?.target).toEqual({ type: "table", id: "ta" });
  });

  it("rows with an empty cavity do not count as duplicates", () => {
    const doc = docWith(
      ["A"],
      [
        {
          id: "ta",
          node: "a",
          title: "A",
          rows: [
            ["", "", "", ""],
            ["", "", "", ""],
          ],
        },
      ],
    );
    expect(validateDoc(doc, t)).toEqual([]);
  });
});

describe("note references", () => {
  const withNotes = (refs: string): HarnessDoc =>
    normalizeDoc({
      nodes: [{ id: "a", x: 0, y: 0, kind: "connector", name: "A", style: "plug", refs }],
      tables: [
        {
          id: "tn",
          x: 0,
          y: 0,
          kind: "table",
          title: "Note",
          head: ["N.", "Nota"],
          rows: [
            ["1", "Prima nota"],
            ["2", "Seconda nota"],
          ],
        },
      ],
    });

  it("reports a reference to a note that does not exist", () => {
    const issues = validateDoc(withNotes("[1, 5]"), t);
    const err = errors(issues);
    expect(messages(err)).toEqual(["validate.noteMissing"]);
    expect(err[0]?.target).toEqual({ type: "node", id: "a" });
  });

  it("reports nothing when every note exists", () => {
    expect(validateDoc(withNotes("[1, 2]"), t)).toEqual([]);
  });

  it("checks the branch references too", () => {
    const doc = normalizeDoc({
      nodes: [
        { id: "a", x: 0, y: 0, kind: "connector", name: "A" },
        { id: "b", x: 100, y: 0, kind: "connector", name: "B" },
      ],
      segments: [{ id: "s1", a: "a", b: "b", len: "300 mm", refs: "[9]" }],
      tables: [
        { id: "tn", x: 0, y: 0, kind: "table", title: "Note", head: ["N.", "Nota"], rows: [["1", "Nota"]] },
      ],
    });
    const err = errors(validateDoc(doc, t));
    expect(messages(err)).toEqual(["validate.noteMissing"]);
    expect(err[0]?.target).toEqual({ type: "segment", id: "s1" });
  });

  it("checks nothing without a Notes table", () => {
    const doc = normalizeDoc({
      nodes: [{ id: "a", x: 0, y: 0, kind: "connector", name: "A", refs: "[42]" }],
    });
    expect(validateDoc(doc, t)).toEqual([]);
  });
});

describe("rule registry", () => {
  const disposers: Array<() => void> = [];
  const add = (rule: ValidationRule): void => {
    disposers.push(registerRule(rule));
  };

  afterEach(() => {
    while (disposers.length) disposers.pop()?.();
    vi.restoreAllMocks();
  });

  it("registerRule adds a rule and the returned function removes it", () => {
    const doc = normalizeDoc({});
    expect(validateDoc(doc, t)).toEqual([]);

    const off = registerRule({
      id: "regola-di-prova",
      run: () => [{ rule: "regola-di-prova", severity: "warning", message: "prova" }],
    });

    expect(allRules().map((r) => r.id)).toContain("regola-di-prova");
    expect(rules(validateDoc(doc, t))).toEqual(["regola-di-prova"]);

    off();

    expect(allRules().map((r) => r.id)).not.toContain("regola-di-prova");
    expect(validateDoc(doc, t)).toEqual([]);
  });

  it("the rule receives the context with document and cavity tables already recognized", () => {
    const doc = docWith(["A"], [{ id: "ta", node: "a", title: "A", rows: [["1", "", "rosso", "1.5"]] }]);
    let visto: { tables: number; owner: string | undefined; sameDoc: boolean } | null = null;
    add({
      id: "ispettore",
      run: (ctx) => {
        visto = {
          tables: ctx.tables.length,
          owner: ctx.byOwner.get("A")?.owner,
          sameDoc: ctx.doc === doc,
        };
        return [];
      },
    });

    validateDoc(doc, t);
    expect(visto).toEqual({ tables: 1, owner: "A", sameDoc: true });
  });

  it("a rule that throws does not stop the others producing results", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const doc = docWith(
      ["A"],
      [
        {
          id: "ta",
          node: "a",
          title: "A",
          rows: [
            ["1", "", "rosso", "1.5"],
            ["1", "", "rosso", "1.5"],
          ],
        },
      ],
    );

    add({
      id: "regola-difettosa",
      run: () => {
        throw new Error("guasto");
      },
    });
    add({
      id: "regola-sana",
      run: () => [{ rule: "regola-sana", severity: "warning", message: "sto bene" }],
    });

    const issues = validateDoc(doc, t);

    expect(rules(issues)).toContain("duplicate-cavities");
    expect(rules(issues)).toContain("regola-sana");
    expect(rules(issues)).not.toContain("regola-difettosa");
    expect(spy).toHaveBeenCalled();
  });
});

describe("repeated cavity", () => {
  const doc = (rows: string[][]) =>
    normalizeDoc({
      nodes: [{ id: "n1", x: 0, y: 0, kind: "connector", name: "C1", style: "plug", refs: "" }],
      segments: [],
      tables: [
        {
          id: "t1",
          node: "n1",
          x: 0,
          y: 0,
          kind: "table",
          title: "C1",
          head: ["Cavità", "Verso", "PIN"],
          rows,
        },
      ],
    });

  it("is an error when the rows are indistinguishable", () => {
    const issues = validateDoc(
      doc([
        ["1", "", ""],
        ["1", "", ""],
      ]),
      t,
    ).filter((i) => i.rule === "duplicate-cavities");
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe("error");
  });

  it("is only a warning when the pin carries two wires to different destinations", () => {
    const issues = validateDoc(
      doc([
        ["1", "C9", "1"],
        ["1", "C9", "4"],
      ]),
      t,
    ).filter((i) => i.rule === "duplicate-cavities");
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe("warning");
  });

  it("a lone cavity reports nothing", () => {
    expect(
      validateDoc(
        doc([
          ["1", "C9", "1"],
          ["2", "C9", "2"],
        ]),
        t,
      ).filter((i) => i.rule === "duplicate-cavities"),
    ).toHaveLength(0);
  });
});

describe("joint-cavities", () => {
  /** Two harness halves joined by a mated pair, wired as far as each side says. */
  const jointed = (left: string[][], right: string[][]): HarnessDoc => {
    const doc = docWith(
      ["L", "X", "Y", "R"],
      [
        { id: "tx", node: "x", title: "X", rows: left },
        { id: "ty", node: "y", title: "Y", rows: right },
      ],
    );
    doc.nodes.find((n) => n.id === "x")!.mate = "y";
    doc.nodes.find((n) => n.id === "y")!.mate = "x";
    return normalizeDoc(doc);
  };

  const joint = (doc: HarnessDoc): Issue[] => validateDoc(doc, t).filter((i) => i.rule === "joint-cavities");

  it("says nothing when both sides carry the same cavities", () => {
    expect(
      joint(
        jointed(
          [
            ["1", "L.1", "Rosso", "1.5"],
            ["2", "L.2", "Nero", "1.5"],
          ],
          [
            ["1", "R.1", "Verde", "1.5"],
            ["2", "R.2", "Giallo", "1.5"],
          ],
        ),
      ),
    ).toHaveLength(0);
  });

  it("a colour that changes across the joint is not a fault", () => {
    const issues = validateDoc(jointed([["1", "L.1", "Rosso", "1.5"]], [["1", "R.1", "Verde", "1.5"]]), t);
    expect(issues.filter((i) => i.rule === "joint-cavities")).toHaveLength(0);
    expect(issues.filter((i) => i.rule === "wire-ends")).toHaveLength(0);
  });

  it("reports the cavity wired on one side and dead on the other", () => {
    const issues = joint(
      jointed(
        [
          ["1", "L.1", "Rosso", "1.5"],
          ["2", "L.2", "Nero", "1.5"],
        ],
        [["1", "R.1", "Verde", "1.5"]],
      ),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe("warning");
    expect(issues[0]?.target).toEqual({ type: "node", id: "y" });
  });

  it("reports each direction on its own", () => {
    const issues = joint(jointed([["1", "L.1", "Rosso", "1.5"]], [["2", "R.2", "Verde", "1.5"]]));
    expect(issues).toHaveLength(2);
  });

  it("keeps quiet on connectors that are not mated at all", () => {
    const doc = docWith(
      ["L", "X", "Y", "R"],
      [
        { id: "tx", node: "x", title: "X", rows: [["1", "L.1", "Rosso", "1.5"]] },
        { id: "ty", node: "y", title: "Y", rows: [["2", "R.2", "Verde", "1.5"]] },
      ],
    );
    expect(joint(doc)).toHaveLength(0);
  });
});
