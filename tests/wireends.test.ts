import { describe, expect, it } from "vitest";
import { checkWireEnds } from "@/core/wireends";
import { isGroundColor, wireColorKey } from "@/core/colors";
import { normalizeDoc } from "@/core/doc";
import { validateDoc } from "@/core/validate";
import type { HarnessDoc } from "@/core/types";

/** One connector per table, with a row for each colour given. */
function build(perConnector: Record<string, string[]>, isolated: string[] = []): HarnessDoc {
  const names = Object.keys(perConnector);
  return normalizeDoc({
    nodes: names.map((name, i) => ({
      id: `n${i}`,
      x: i * 50,
      y: 0,
      kind: "connector",
      name,
      style: "plug",
      refs: "",
    })),
    segments: [],
    tables: names.map((name, i) => ({
      id: `t${i}`,
      node: `n${i}`,
      x: 0,
      y: i * 100,
      kind: "table",
      title: name,
      head: ["Cavità", "Colore", "Verso"],
      rows: (perConnector[name] ?? []).map((color, r) => [String(r + 1), color, ""]),
      ...(isolated.includes(name) ? { autoLink: false } : {}),
    })),
  });
}

/**
 * Connectors with rows of `[colour, destination]`, and splices by name. A splice
 * has no table, as in a real drawing: the wires reaching it say so in theirs.
 */
function wired(perConnector: Record<string, [string, string][]>, splices: string[] = []): HarnessDoc {
  const names = Object.keys(perConnector);
  return normalizeDoc({
    nodes: [
      ...names.map((name, i) => ({
        id: `n${i}`,
        x: i * 50,
        y: 0,
        kind: "connector",
        name,
        style: "plug",
        refs: "",
      })),
      ...splices.map((name, i) => ({
        id: `s${i}`,
        x: i * 50,
        y: 300,
        kind: "connector",
        name,
        style: "splice",
        refs: "",
      })),
    ],
    segments: [],
    tables: names.map((name, i) => ({
      id: `t${i}`,
      node: `n${i}`,
      x: 0,
      y: i * 100,
      kind: "table",
      title: name,
      head: ["Cavità", "Colore", "Verso"],
      rows: (perConnector[name] ?? []).map(([color, dest], r) => [String(r + 1), color, dest]),
    })),
  });
}

const t = (key: string, params?: Record<string, string | number>): string =>
  params ? `${key}:${JSON.stringify(params)}` : key;

describe("colour fingerprint", () => {
  it("is independent of language, codes and separators", () => {
    expect(wireColorKey("Bianco/Giallo")).toBe(wireColorKey("bianco,giallo"));
    expect(wireColorKey("WS/GE")).toBe(wireColorKey("white+yellow"));
    expect(wireColorKey("bianco/giallo")).toBe(wireColorKey("WS/GE"));
  });

  it("tells base from tracer: order matters", () => {
    expect(wireColorKey("bianco/giallo")).not.toBe(wireColorKey("giallo/bianco"));
  });

  it("is undefined for text that is not a colour", () => {
    expect(wireColorKey("0.5 mm²")).toBeNull();
    expect(wireColorKey("")).toBeNull();
  });
});

describe("recognizing ground", () => {
  it("plain black is ground, however it is written", () => {
    expect(isGroundColor("nero")).toBe(true);
    expect(isGroundColor("black")).toBe(true);
    expect(isGroundColor("BK")).toBe(true);
    expect(isGroundColor("#000000")).toBe(true);
  });

  it("black with a tracer is not ground", () => {
    expect(isGroundColor("nero/bianco")).toBe(false);
    expect(isGroundColor("bianco")).toBe(false);
  });
});

describe("two-ends rule", () => {
  it("two connectors sharing a colour are fine", () => {
    const report = checkWireEnds(build({ C1: ["bianco/giallo"], C3: ["bianco/giallo"] }));
    expect(report.conflicts).toHaveLength(0);
    expect(report.rowsByTable.size).toBe(0);
  });

  it("three connectors sharing a colour is an error, reported on all of them", () => {
    const doc = build({ C1: ["bianco/giallo"], C3: ["bianco/giallo"], C4: ["bianco/giallo"] });
    const report = checkWireEnds(doc);

    expect(report.conflicts).toHaveLength(1);
    expect(report.conflicts[0]?.owners).toEqual(["C1", "C3", "C4"]);
    // every table involved has its own row to highlight
    expect([...report.rowsByTable.keys()].sort()).toEqual(["t0", "t1", "t2"]);
    for (const rows of report.rowsByTable.values()) expect([...rows]).toEqual([0]);
  });

  it("black is ground and never triggers the error", () => {
    const doc = build({ C1: ["nero"], C2: ["nero"], C3: ["nero"], C4: ["black"], C5: ["BK"] });
    expect(checkWireEnds(doc).conflicts).toHaveLength(0);
  });

  it("the same colour repeated within one connector is not an error", () => {
    const doc = build({ C1: ["rosso", "rosso", "rosso"], C3: ["rosso"] });
    expect(checkWireEnds(doc).conflicts).toHaveLength(0);
  });

  it("an isolated table takes no part in the count", () => {
    const doc = build({ C1: ["verde"], C3: ["verde"], C5: ["verde"] }, ["C5"]);
    expect(checkWireEnds(doc).conflicts).toHaveLength(0);
  });

  it("recognizes the same wire written with different codes", () => {
    const doc = build({ C1: ["bianco/giallo"], C3: ["WS/GE"], C4: ["white/yellow"] });
    expect(checkWireEnds(doc).conflicts).toHaveLength(1);
  });

  it("the wire list does not skew the count", () => {
    const doc = build({ C1: ["rosso"], C3: ["rosso"] });
    doc.tables.push({
      id: "wl",
      x: 0,
      y: 0,
      kind: "table",
      title: "Distinta fili",
      head: ["#", "Da", "A", "Funzione", "Colore", "Sezione"],
      rows: [["1", "C1.1", "C3.1", "", "rosso", ""]],
    });
    expect(checkWireEnds(doc).conflicts).toHaveLength(0);
  });

  it("the overall check reports the problem with the connectors involved", () => {
    const doc = build({ C1: ["blu"], C3: ["blu"], C4: ["blu"] });
    const issues = validateDoc(doc, t).filter((i) => i.rule === "wire-ends");

    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe("error");
    expect(issues[0]?.message).toContain("C1, C3, C4");
    expect(issues[0]?.target?.type).toBe("table");
  });
});

describe("two-ends rule at a splice", () => {
  it("every wire of a colour reaching the same splice is one circuit", () => {
    const doc = wired(
      {
        ECU: [["rosso", "S1"]],
        INJ1: [["rosso", "S1"]],
        INJ2: [["rosso", "S1"]],
        INJ3: [["rosso", "S1 → W1"]],
      },
      ["S1"],
    );
    expect(checkWireEnds(doc).conflicts).toHaveLength(0);
    expect(validateDoc(doc, t).filter((i) => i.rule === "wire-ends")).toHaveLength(0);
  });

  it("the colour coming back in a wire off the splice is still an error, on that wire only", () => {
    const doc = wired(
      {
        ECU: [["rosso", "S1"]],
        INJ1: [["rosso", "S1"]],
        INJ2: [["rosso", "S1"]],
        FAN: [["rosso", "RLY.2"]],
        RLY: [
          ["", ""],
          ["rosso", "FAN.1"],
        ],
      },
      ["S1"],
    );
    const report = checkWireEnds(doc);
    expect(report.conflicts).toHaveLength(1);
    expect(report.conflicts[0]?.splice).toBe("S1");
    expect(report.conflicts[0]?.stray).toEqual(["FAN", "RLY"]);
    // the rows on the splice are fine, the two off it are the ones to look at
    expect([...report.rowsByTable.keys()].sort()).toEqual(["t3", "t4"]);
    expect([...(report.rowsByTable.get("t4") ?? [])]).toEqual([1]);

    const issues = validateDoc(doc, t).filter((i) => i.rule === "wire-ends");
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain("validate.wireOffSplice");
    expect(issues[0]?.message).toContain("FAN, RLY");
    expect(issues[0]?.target).toEqual({ type: "table", id: "t3" });
    expect(issues[0]?.color).toBe("rosso");
  });

  it("one colour on two different splices is two circuits", () => {
    const doc = wired(
      {
        A: [["blu", "S1"]],
        B: [["blu", "S1"]],
        C: [["blu", "S1"]],
        D: [["blu", "S2"]],
        E: [["blu", "S2"]],
      },
      ["S1", "S2"],
    );
    const report = checkWireEnds(doc);
    expect(report.conflicts).toHaveLength(1);
    expect(report.conflicts[0]?.splice).toBe("S1");
    expect(report.conflicts[0]?.stray).toEqual(["D", "E"]);
  });

  it("a connector named like a splice is not one", () => {
    const doc = wired({
      A: [["verde", "S1"]],
      B: [["verde", "S1"]],
      S1: [
        ["verde", ""],
        ["verde", ""],
      ],
    });
    expect(checkWireEnds(doc).conflicts).toHaveLength(1);
  });

  it("each wire off a splice may still carry its own tracer", () => {
    const doc = wired(
      { FB: [["rosso/giallo", "S3"]], INJ1: [["rosso/viola", "S3"]], INJ2: [["rosso/rosa", "S3"]] },
      ["S3"],
    );
    expect(checkWireEnds(doc).conflicts).toHaveLength(0);
  });
});
