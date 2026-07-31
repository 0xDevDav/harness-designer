import { normalizeDoc } from "./doc";
import { WIRE_PALETTE } from "./colors";
import type { HarnessDoc, HNode, Inline, Segment, Table } from "./types";
import { getLocale } from "@/i18n";
import type { Translate } from "@/i18n";

/**
 * Colour name in the interface language.
 *
 * The sample is a worked example, so its cells have to read the way the user's
 * own would. An English drawing showing an Italian colour name is a small
 * thing, but it is the kind that makes an example look careless.
 */
function colour(key: string): string {
  const entry = WIRE_PALETTE.find((c) => c.key === key);
  if (!entry) return key;
  // Italian for Italian, English for everything else: a German reading the
  // sample is better served by "yellow" than by "giallo", and colorOf reads
  // both back either way.
  return getLocale() === "it" ? entry.it : entry.en;
}

/** Two-band colour, base over tracer, in the interface language. */
const banded = (base: string, tracer: string): string => `${colour(base)},${colour(tracer)}`;

/**
 * Demonstration document: towbar wiring kit with a 13-pin ISO 11446 socket.
 * It is deliberately a real case (backbone along the floor pan, feeds from the
 * engine bay with fuses, ring and splice grounds, sockets at the lamps) because
 * it doubles as a worked example of how to fill in the cavity tables.
 */
export function sampleDoc(t: Translate): HarnessDoc {
  const nodes: HNode[] = [];
  const segments: Segment[] = [];
  const inlines: Inline[] = [];
  const tables: Table[] = [];

  const node = (
    id: string,
    x: number,
    y: number,
    kind: HNode["kind"] = "junction",
    name = "",
    style = "plug",
    refs = "",
  ): string => {
    nodes.push({ id, x, y, kind, name, style, refs });
    return id;
  };
  const seg = (id: string, a: string, b: string, len = "", refs = ""): void => {
    segments.push({ id, a, b, len, refs });
  };
  const inline = (id: string, s: string, at: number, text: string, color: string): void => {
    inlines.push({ id, seg: s, t: at, text, color });
  };

  // backbone along the floor pan, 13-pin socket at the right-hand end
  node("j1", 400, 560);
  node("j2", 620, 560);
  node("j3", 840, 560);
  node("j5", 1150, 560);
  node("c13", 1400, 560, "connector", "C13", "plug", "[1, 7]");
  seg("sb1", "j1", "j2", "600 mm", "[1]");
  seg("sb2", "j2", "j3", "400 mm", "[1]");
  seg("sb3", "j3", "j5", "500 mm", "[1]");
  seg("sb4", "j5", "c13", "350 mm", "[7]");

  // feeds from the engine bay: cavity 9 = +30, cavity 10 = +15
  node("bp", 160, 510, "connector", "B+", "ring", "[2, 3]");
  seg("pw1", "j1", "bp", "5000 mm", "[2]");
  node("c15", 160, 680, "connector", "C15", "faston", "[2, 3]");
  seg("pw2", "j1", "c15", "4500 mm", "[2]");

  // signal sockets on the rear lamp clusters
  node("cl", 520, 820, "connector", "CL", "plug", "[5]");
  seg("bl1", "j2", "cl", "450 mm", "[1]");
  node("cr", 1250, 820, "connector", "CR", "plug", "[5]");
  seg("br1", "j5", "cr", "480 mm", "[1]");

  // grounds: ring terminal on the floor pan, splice joining the 11/13 returns
  node("jw", 840, 420);
  seg("gm0", "j3", "jw", "250 mm");
  node("w1", 740, 340, "connector", "W1", "ring", "[4]");
  seg("gm1", "jw", "w1", "200 mm");
  node("s1", 950, 360, "connector", "S1", "splice", "[6]");
  seg("gm2", "jw", "s1", "80 mm", "[6]");

  // fuses and coverings
  inline("i1", "pw1", 0.28, "FUS 15A", "#c62828");
  inline("i2", "pw2", 0.28, "FUS 20A", "#c62828");
  inline("i3", "pw1", 0.62, "COR ø9", "#e8942a");
  inline("i4", "pw2", 0.62, "COR ø9", "#e8942a");
  inline("i5", "sb1", 0.5, "COR ø13", "#e8942a");
  inline("i6", "sb2", 0.5, "COR ø13", "#e8942a");
  inline("i7", "sb3", 0.5, "COR ø13", "#e8942a");
  inline("i8", "sb4", 0.5, t("sample.inline.sheath"), "#444444");
  inline("i9", "bl1", 0.5, t("sample.inline.tape"), "#c9b273");
  inline("i10", "br1", 0.5, t("sample.inline.tape"), "#c9b273");

  const H = {
    cavity: t("table.head.cavity"),
    din: t("table.head.din"),
    func: t("table.head.function"),
    dest: t("table.head.dest"),
    color: t("table.head.color"),
    section: t("table.head.section"),
  };

  tables.push({
    id: "t1",
    x: 40,
    y: 20,
    kind: "table",
    title: t("table.title.notes"),
    head: [t("table.head.num"), t("table.head.note")],
    rows: [
      ["1", t("sample.note1")],
      ["2", t("sample.note2")],
      ["3", t("sample.note3")],
      ["4", t("sample.note4")],
      ["5", t("sample.note5")],
      ["6", t("sample.note6")],
      ["7", t("sample.note7")],
    ],
  });

  tables.push({
    id: "t2",
    node: "c13",
    x: 1180,
    y: 240,
    kind: "table",
    title: t("sample.table.socket"),
    head: [H.cavity, H.din, H.func, H.dest, H.color, H.section],
    rows: [
      ["1", "L", t("sample.fn.indicatorL"), "CL.1", colour("yellow"), "1.5 mm²"],
      ["2", "54G", t("sample.fn.fog"), "CL.3", colour("blue"), "1.5 mm²"],
      ["3", "31", t("sample.fn.ground"), "W1", colour("white"), "2.5 mm²"],
      ["4", "R", t("sample.fn.indicatorR"), "CR.1", colour("green"), "1.5 mm²"],
      ["5", "58R", t("sample.fn.positionR"), "CR.2", colour("brown"), "1.5 mm²"],
      ["6", "54", t("sample.fn.stop"), "CR.3", colour("red"), "1.5 mm²"],
      ["7", "58L", t("sample.fn.positionL"), "CL.2", colour("black"), "1.5 mm²"],
      ["8", "-", t("sample.fn.reverse"), "CR.4", colour("pink"), "1.5 mm²"],
      ["9", "30", t("sample.fn.permanent"), "B+ (FUS 15A)", colour("orange"), "2.5 mm²"],
      ["10", "15", t("sample.fn.ignition"), "C15 (FUS 20A)", colour("grey"), "2.5 mm²"],
      ["11", "31", t("sample.fn.ground10"), "S1 → W1", banded("white", "black"), "2.5 mm²"],
      ["12", "-", t("sample.fn.spare"), "n.c.", "-", "-"],
      ["13", "31", t("sample.fn.ground9"), "S1 → W1", banded("white", "red"), "2.5 mm²"],
    ],
  });

  tables.push({
    id: "t3",
    node: "cl",
    x: 240,
    y: 900,
    kind: "table",
    title: t("sample.table.left"),
    head: [H.cavity, H.dest, H.func, H.color, H.section],
    rows: [
      ["1", "C13.1", t("sample.fn.indicatorL"), colour("yellow"), "1.5 mm²"],
      ["2", "C13.7", t("sample.fn.positionL"), colour("black"), "1.5 mm²"],
      ["3", "C13.2", t("sample.fn.fog"), colour("blue"), "1.5 mm²"],
    ],
  });

  tables.push({
    id: "t4",
    node: "cr",
    x: 1350,
    y: 860,
    kind: "table",
    title: t("sample.table.right"),
    head: [H.cavity, H.dest, H.func, H.color, H.section],
    rows: [
      ["1", "C13.4", t("sample.fn.indicatorR"), colour("green"), "1.5 mm²"],
      ["2", "C13.5", t("sample.fn.positionR"), colour("brown"), "1.5 mm²"],
      ["3", "C13.6", t("sample.fn.stop"), colour("red"), "1.5 mm²"],
      ["4", "C13.8", t("sample.fn.reverse"), colour("pink"), "1.5 mm²"],
    ],
  });

  tables.push({
    id: "t5",
    x: 40,
    y: 200,
    kind: "table",
    title: t("table.title.revisions"),
    head: [t("table.head.rev"), t("table.head.date"), t("table.head.author"), t("table.head.description")],
    rows: [
      ["A", "10/02/2026", "0xDevDav", t("sample.rev.first")],
      ["B", "09/07/2026", "0xDevDav", t("sample.rev.second")],
    ],
  });

  tables.push({ id: "t6", x: 650, y: 1000, kind: "title", rows: [] });

  return normalizeDoc({
    meta: {
      title: t("sample.title"),
      description: t("sample.description"),
      partNumber: "KE-11446.02-B",
      revision: "B",
      company: t("sample.company"),
      drawnBy: "0xDevDav",
      date: new Date().toLocaleDateString(),
    },
    nodes,
    segments,
    inlines,
    tables,
  });
}
