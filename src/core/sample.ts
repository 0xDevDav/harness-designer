import { normalizeDoc } from "./doc";
import type { HarnessDoc, HNode, Inline, Point, Segment, Table } from "./types";
import type { Translate } from "@/i18n";

/**
 * Demonstration document: the engine harness of a four-cylinder petrol car.
 *
 * It is a real case rather than a toy, because it doubles as a worked example of
 * how the whole program is meant to be used: battery and main fuse, fuse and
 * relay box, alternator, an ECU on two connectors, four injectors and four
 * coil-on-plug coils, the sensors round the engine, two mated pairs, three
 * splices, the grounds, and the CAN link through the bulkhead to the cluster and
 * the diagnostic socket.
 *
 * **The document is written in English**, whatever language the interface is
 * in. Signal names, connector names and colour codes are English on a real
 * drawing too, and a pin-out that changes wording with the menu language would
 * be a poor example of a document that gets handed to somebody else.
 *
 * Two things about it are worth reading before changing it:
 *
 * - **Every wire is declared once**, in `WIRES`, and both cavity tables are
 *   generated from that. Cross-references, colours and sections therefore
 *   cannot disagree between the two ends, which is exactly the mistake the
 *   consistency check exists to catch — an example that trips its own checks
 *   would teach the wrong lesson. `tests/sample.test.ts` holds it to that.
 * - **Every colour appears in at most two connectors**, because that is the
 *   two-ends rule, and plain black is the only one bridged further, because it
 *   is ground. That is why the wires fanning out of a splice each carry their
 *   own tracer: downstream of a splice they are different wires, and a drawing
 *   that gave them one code could not tell you which one you are holding.
 */

/* ============================ what is in the harness ============================ */

interface Terminal {
  /** name the cavity tables refer to it by */
  name: string;
  x: number;
  y: number;
  style: "plug" | "ring" | "splice";
  /** how many cavities: a ring terminal or a splice has none */
  ways?: number;
  /** title of its cavity table; only connectors with cavities get one */
  title?: string;
  refs?: string;
  /** where that table sits on the sheet: beside the connector it describes */
  table?: Point;
}

const TERMINALS: Terminal[] = [
  // battery and power distribution
  {
    name: "BAT",
    x: 130,
    y: 620,
    style: "ring",
    ways: 2,
    title: "BAT — Battery terminals",
    refs: "[2]",
    table: { x: -20, y: 510 },
  },
  { name: "G3", x: 150, y: 850, style: "ring", refs: "[4]" },
  {
    name: "FB",
    x: 280,
    y: 460,
    style: "plug",
    ways: 9,
    title: "FB — Engine bay fuse and relay box",
    refs: "[2]",
    table: { x: 60, y: 200 },
  },
  {
    name: "ALT",
    x: 470,
    y: 1030,
    style: "plug",
    ways: 3,
    title: "ALT — Alternator",
    refs: "[3]",
    table: { x: 270, y: 1090 },
  },

  // engine control unit, on two connectors that cannot be swapped
  {
    name: "ECU-A",
    x: 750,
    y: 350,
    style: "plug",
    ways: 12,
    title: "ECU-A — Engine control unit, power and network",
    refs: "[3]",
    table: { x: 560, y: 40 },
  },
  {
    name: "ECU-B",
    x: 1060,
    y: 400,
    style: "plug",
    ways: 16,
    title: "ECU-B — Engine control unit, sensors and actuators",
    refs: "[3]",
    table: { x: 930, y: 10 },
  },
  { name: "G1", x: 770, y: 1040, style: "ring", refs: "[4]" },

  // supply splice and the four cylinders
  { name: "S3", x: 900, y: 1090, style: "splice", refs: "[5]" },
  {
    name: "INJ1",
    x: 890,
    y: 1270,
    style: "plug",
    ways: 2,
    title: "INJ1 — Injector, cylinder 1",
    table: { x: 710, y: 1330 },
  },
  {
    name: "IGN1",
    x: 1090,
    y: 1340,
    style: "plug",
    ways: 3,
    title: "IGN1 — Ignition coil, cylinder 1",
    table: { x: 930, y: 1410 },
  },
  {
    name: "INJ2",
    x: 1340,
    y: 1250,
    style: "plug",
    ways: 2,
    title: "INJ2 — Injector, cylinder 2",
    table: { x: 1150, y: 1320 },
  },
  {
    name: "IGN2",
    x: 1490,
    y: 1350,
    style: "plug",
    ways: 3,
    title: "IGN2 — Ignition coil, cylinder 2",
    table: { x: 1320, y: 1420 },
  },
  {
    name: "INJ3",
    x: 1670,
    y: 1270,
    style: "plug",
    ways: 2,
    title: "INJ3 — Injector, cylinder 3",
    table: { x: 1510, y: 1340 },
  },
  {
    name: "IGN3",
    x: 1860,
    y: 1360,
    style: "plug",
    ways: 3,
    title: "IGN3 — Ignition coil, cylinder 3",
    table: { x: 1740, y: 1430 },
  },
  {
    name: "INJ4",
    x: 2020,
    y: 1260,
    style: "plug",
    ways: 2,
    title: "INJ4 — Injector, cylinder 4",
    table: { x: 2060, y: 1230 },
  },
  {
    name: "IGN4",
    x: 2150,
    y: 1150,
    style: "plug",
    ways: 3,
    title: "IGN4 — Ignition coil, cylinder 4",
    table: { x: 1910, y: 1320 },
  },

  // sensors, with their supply and return splices
  {
    name: "CKP",
    x: 1290,
    y: 490,
    style: "plug",
    ways: 3,
    title: "CKP — Crankshaft position sensor",
    table: { x: 1120, y: 330 },
  },
  {
    name: "CMP",
    x: 1500,
    y: 340,
    style: "plug",
    ways: 3,
    title: "CMP — Camshaft position sensor",
    table: { x: 1360, y: 180 },
  },
  {
    name: "MAP",
    x: 1700,
    y: 460,
    style: "plug",
    ways: 4,
    title: "MAP — Manifold pressure and intake air temperature",
    table: { x: 1570, y: 280 },
  },
  { name: "S1", x: 1690, y: 555, style: "splice", refs: "[6]" },
  {
    name: "ECT",
    x: 1970,
    y: 330,
    style: "plug",
    ways: 2,
    title: "ECT — Coolant temperature sensor",
    table: { x: 1800, y: 190 },
  },
  { name: "S2", x: 2160, y: 460, style: "splice", refs: "[6]" },

  // flying pair: the lambda and knock sensors are a sub-harness of their own
  {
    name: "IL-A",
    x: 2180,
    y: 630,
    style: "plug",
    ways: 6,
    title: "IL-A — Inline pair, harness side",
    refs: "[8]",
    table: { x: 2050, y: 670 },
  },
  {
    name: "IL-B",
    x: 2620,
    y: 630,
    style: "plug",
    ways: 6,
    title: "IL-B — Inline pair, sensor side",
    refs: "[8]",
    table: { x: 2460, y: 670 },
  },
  {
    name: "O2S",
    x: 2630,
    y: 410,
    style: "plug",
    ways: 4,
    title: "O2S — Heated oxygen sensor, upstream",
    table: { x: 2420, y: 240 },
  },
  {
    name: "KS",
    x: 2930,
    y: 390,
    style: "plug",
    ways: 2,
    title: "KS — Knock sensor",
    table: { x: 2850, y: 260 },
  },

  // bulkhead pair and the cabin
  {
    name: "BH-E",
    x: 2400,
    y: 900,
    style: "plug",
    ways: 8,
    title: "BH-E — Bulkhead connector, engine side",
    refs: "[7]",
    table: { x: 2240, y: 930 },
  },
  {
    name: "BH-C",
    x: 2790,
    y: 900,
    style: "plug",
    ways: 8,
    title: "BH-C — Bulkhead connector, cabin side",
    refs: "[7]",
    table: { x: 2600, y: 930 },
  },
  {
    name: "DASH",
    x: 3110,
    y: 760,
    style: "plug",
    ways: 12,
    title: "DASH — Instrument cluster",
    table: { x: 2980, y: 430 },
  },
  {
    name: "DLC",
    x: 3220,
    y: 830,
    style: "plug",
    ways: 4,
    title: "DLC — Diagnostic socket (OBD-II)",
    table: { x: 3300, y: 780 },
  },
  { name: "G2", x: 3130, y: 1060, style: "ring", refs: "[4]" },
];

/** Nodes the bundle merely runs through: they carry no name and no table. */
const JUNCTIONS: { id: string; x: number; y: number }[] = [
  { id: "jbat", x: 350, y: 720 },
  { id: "t1", x: 620, y: 900 },
  { id: "t2", x: 980, y: 900 },
  { id: "jecu", x: 980, y: 700 },
  { id: "t3", x: 1180, y: 900 },
  { id: "t4", x: 1340, y: 900 },
  { id: "t5", x: 1560, y: 900 },
  { id: "t6", x: 1780, y: 900 },
  { id: "t7", x: 2000, y: 900 },
  { id: "t8", x: 2200, y: 900 },
  { id: "sj0", x: 1340, y: 680 },
  { id: "sj1", x: 1560, y: 680 },
  { id: "sj2", x: 1850, y: 630 },
  { id: "sj3", x: 2000, y: 640 },
  { id: "jil", x: 2790, y: 580 },
  { id: "jc", x: 3030, y: 900 },
];

const NOTES_AT = { x: 1550, y: -130 };
const REVISIONS_AT = { x: 1970, y: -90 };
const TITLE_AT = { x: 1190, y: 1620 };

const SCHEMATIC: Record<string, Point> = {
  BAT: { x: 1820, y: 2360 },
  FB: { x: 1290, y: 2940 },
  ALT: { x: 1810, y: 2040 },
  "ECU-A": { x: 1910, y: 2760 },
  "ECU-B": { x: -750, y: 2450 },
  INJ1: { x: 745, y: 1879 },
  IGN1: { x: 727, y: 2287 },
  INJ2: { x: 745, y: 1981 },
  IGN2: { x: 727, y: 2407 },
  INJ3: { x: 745, y: 2083 },
  IGN3: { x: 727, y: 2527 },
  INJ4: { x: 745, y: 2185 },
  IGN4: { x: 727, y: 2647 },
  CKP: { x: 727, y: 2767 },
  CMP: { x: 734, y: 2887 },
  MAP: { x: 662, y: 3007 },
  ECT: { x: 727, y: 3145 },
  "IL-A": { x: 727, y: 3247 },
  "IL-B": { x: 1290, y: 3270 },
  O2S: { x: 1940, y: 3050 },
  KS: { x: 1960, y: 3220 },
  "BH-E": { x: 2360, y: 2430 },
  "BH-C": { x: 2730, y: 2430 },
  DASH: { x: 3260, y: 2420 },
  DLC: { x: 3650, y: 2500 },
  G3: { x: 2440, y: 2240 },
  G1: { x: 1370, y: 2350 },
  S3: { x: 1370, y: 1990 },
  S1: { x: 1370, y: 2600 },
  S2: { x: 1360, y: 2790 },
  G2: { x: 3730, y: 2680 },
};

/** A branch: the two nodes it joins, its cut length, and the notes about it. */
type Branch = [from: string, to: string, len: string, refs?: string];

const BRANCHES: Branch[] = [
  // battery, main fuse and the run into the fuse box
  ["BAT", "jbat", "300 mm", "[2]"],
  ["jbat", "G3", "200 mm", "[4]"],
  ["jbat", "t1", "600 mm", "[1]"],
  ["t1", "FB", "250 mm", "[2]"],
  ["t1", "ALT", "450 mm", "[3]"],

  // backbone along the engine
  ["t1", "t2", "380 mm", "[1]"],
  ["t2", "jecu", "200 mm"],
  ["jecu", "ECU-A", "180 mm", "[3]"],
  ["jecu", "ECU-B", "180 mm", "[3]"],
  ["t2", "G1", "250 mm", "[4]"],
  ["t2", "t3", "220 mm", "[1]"],
  ["t3", "S3", "180 mm", "[5]"],
  ["t3", "t4", "180 mm", "[1]"],
  ["t4", "t5", "230 mm", "[1]"],
  ["t5", "t6", "230 mm", "[1]"],
  ["t6", "t7", "230 mm", "[1]"],
  ["t7", "t8", "220 mm", "[1]"],

  // the four cylinders: an injector and a coil hanging off each drop
  ["t4", "INJ1", "260 mm"],
  ["t4", "IGN1", "260 mm"],
  ["t5", "INJ2", "260 mm"],
  ["t5", "IGN2", "260 mm"],
  ["t6", "INJ3", "260 mm"],
  ["t6", "IGN3", "260 mm"],
  ["t7", "INJ4", "260 mm"],
  ["t7", "IGN4", "260 mm"],

  // sensor run above the backbone
  ["t4", "sj0", "240 mm", "[1]"],
  ["sj0", "CKP", "220 mm"],
  ["sj0", "CMP", "200 mm"],
  ["sj0", "sj1", "230 mm"],
  ["sj1", "MAP", "200 mm"],
  ["sj1", "S1", "160 mm", "[6]"],
  ["sj1", "sj2", "230 mm"],
  ["sj2", "ECT", "200 mm"],
  ["sj2", "S2", "160 mm", "[6]"],
  ["sj2", "sj3", "230 mm"],
  ["sj3", "IL-A", "180 mm", "[8]"],
  ["IL-B", "jil", "170 mm", "[8]"],
  ["jil", "O2S", "220 mm", "[8]"],
  ["jil", "KS", "180 mm"],

  // bulkhead and cabin
  ["t8", "BH-E", "200 mm", "[7]"],
  ["BH-C", "jc", "200 mm", "[7]"],
  ["jc", "DASH", "180 mm"],
  ["jc", "DLC", "180 mm"],
  ["jc", "G2", "150 mm", "[4]"],
];

/** Fuses, conduit and tape, sitting on the branch they protect or cover. */
type Marker = [from: string, to: string, at: number, text: string, color: string];

const MARKERS: Marker[] = [
  ["BAT", "jbat", 0.5, "FUS 40A", "#c62828"],
  ["jbat", "t1", 0.5, "COR ø20", "#e8942a"],
  ["t1", "ALT", 0.5, "SLEEVE", "#444444"],
  ["t1", "t2", 0.5, "COR ø20", "#e8942a"],
  ["t2", "t3", 0.5, "COR ø20", "#e8942a"],
  ["t3", "t4", 0.5, "COR ø16", "#e8942a"],
  ["t4", "sj0", 0.5, "COR ø13", "#e8942a"],
  ["sj3", "IL-A", 0.5, "TAPE", "#c9b273"],
  ["t8", "BH-E", 0.5, "SLEEVE", "#444444"],
];

/* ============================ the wires ============================ */

/**
 * One wire, declared once and written into the tables at both of its ends.
 *
 * An endpoint is `NAME.cavity`, or a bare `NAME` for a ring terminal or a
 * splice — they have nothing to number, and the drawing has no table for them.
 */
interface Wire {
  from: string;
  to: string;
  /** what it does: the same words appear at both ends */
  fn: string;
  color: string;
  mm: string;
}

/** Ground: the one colour a harness is allowed to bridge across everything. */
const GND = "black";

const WIRES: Wire[] = [
  /* ---- battery, main supply, alternator ---- */
  { from: "BAT.1", to: "FB.1", fn: "Battery positive", color: "red", mm: "16 mm²" },
  { from: "BAT.2", to: "G3", fn: "Battery ground", color: GND, mm: "16 mm²" },
  { from: "FB.9", to: "ALT.1", fn: "Alternator output", color: "red/grey", mm: "10 mm²" },
  { from: "ALT.2", to: "BH-E.7", fn: "Charge warning lamp", color: "yellow/violet", mm: "0.75 mm²" },
  { from: "ALT.3", to: "G1", fn: "Alternator ground", color: GND, mm: "2.5 mm²" },

  /* ---- fuse box outputs ---- */
  { from: "FB.2", to: "ECU-A.1", fn: "ECU permanent supply", color: "red/white", mm: "2.5 mm²" },
  { from: "FB.3", to: "S3", fn: "Coil and injector supply", color: "red/yellow", mm: "2.5 mm²" },
  { from: "FB.4", to: "IL-A.3", fn: "Oxygen sensor heater supply", color: "red/green", mm: "1.5 mm²" },
  { from: "FB.5", to: "BH-E.6", fn: "Cabin permanent supply", color: "red/blue", mm: "2.5 mm²" },
  { from: "FB.6", to: "ECU-A.7", fn: "Main relay control", color: "orange/black", mm: "0.75 mm²" },
  { from: "FB.7", to: "BH-E.5", fn: "Ignition switch input", color: "red/brown", mm: "2.5 mm²" },
  { from: "FB.8", to: "ECU-A.2", fn: "ECU switched supply", color: "red/black", mm: "2.5 mm²" },

  /* ---- ECU power, grounds and network ---- */
  { from: "ECU-A.3", to: "G1", fn: "ECU ground 1", color: GND, mm: "2.5 mm²" },
  { from: "ECU-A.4", to: "G1", fn: "ECU ground 2", color: GND, mm: "2.5 mm²" },
  { from: "ECU-A.5", to: "BH-E.1", fn: "CAN High", color: "yellow/green", mm: "0.5 mm²" },
  { from: "ECU-A.6", to: "BH-E.2", fn: "CAN Low", color: "yellow/brown", mm: "0.5 mm²" },
  { from: "ECU-A.8", to: "BH-E.3", fn: "Malfunction lamp", color: "violet/white", mm: "0.75 mm²" },
  { from: "ECU-A.9", to: "BH-E.4", fn: "Engine speed output", color: "violet/yellow", mm: "0.75 mm²" },
  { from: "ECU-A.10", to: "S1", fn: "Sensor 5 V supply", color: "grey/red", mm: "1 mm²" },
  { from: "ECU-A.11", to: "S2", fn: "Sensor ground", color: GND, mm: "1 mm²" },

  /* ---- injectors ---- */
  { from: "S3", to: "INJ1.1", fn: "Injector 1 supply", color: "red/violet", mm: "1 mm²" },
  { from: "S3", to: "INJ2.1", fn: "Injector 2 supply", color: "red/pink", mm: "1 mm²" },
  { from: "S3", to: "INJ3.1", fn: "Injector 3 supply", color: "red/orange", mm: "1 mm²" },
  { from: "S3", to: "INJ4.1", fn: "Injector 4 supply", color: "red/turquoise", mm: "1 mm²" },
  { from: "ECU-B.1", to: "INJ1.2", fn: "Injector 1 drive", color: "brown/white", mm: "1 mm²" },
  { from: "ECU-B.2", to: "INJ2.2", fn: "Injector 2 drive", color: "brown/yellow", mm: "1 mm²" },
  { from: "ECU-B.3", to: "INJ3.2", fn: "Injector 3 drive", color: "brown/green", mm: "1 mm²" },
  { from: "ECU-B.4", to: "INJ4.2", fn: "Injector 4 drive", color: "brown/blue", mm: "1 mm²" },

  /* ---- ignition coils ---- */
  { from: "S3", to: "IGN1.1", fn: "Coil 1 supply", color: "red/beige", mm: "1.5 mm²" },
  { from: "S3", to: "IGN2.1", fn: "Coil 2 supply", color: "red/gold", mm: "1.5 mm²" },
  { from: "S3", to: "IGN3.1", fn: "Coil 3 supply", color: "red/silver", mm: "1.5 mm²" },
  { from: "S3", to: "IGN4.1", fn: "Coil 4 supply", color: "red/lightblue", mm: "1.5 mm²" },
  { from: "IGN1.2", to: "G1", fn: "Coil 1 ground", color: GND, mm: "1.5 mm²" },
  { from: "IGN2.2", to: "G1", fn: "Coil 2 ground", color: GND, mm: "1.5 mm²" },
  { from: "IGN3.2", to: "G1", fn: "Coil 3 ground", color: GND, mm: "1.5 mm²" },
  { from: "IGN4.2", to: "G1", fn: "Coil 4 ground", color: GND, mm: "1.5 mm²" },
  { from: "ECU-B.5", to: "IGN1.3", fn: "Coil 1 trigger", color: "green/white", mm: "1 mm²" },
  { from: "ECU-B.6", to: "IGN2.3", fn: "Coil 2 trigger", color: "green/yellow", mm: "1 mm²" },
  { from: "ECU-B.7", to: "IGN3.3", fn: "Coil 3 trigger", color: "green/red", mm: "1 mm²" },
  { from: "ECU-B.8", to: "IGN4.3", fn: "Coil 4 trigger", color: "green/blue", mm: "1 mm²" },

  /* ---- sensors ---- */
  { from: "ECU-B.9", to: "CKP.1", fn: "Crank sensor signal +", color: "blue/white", mm: "0.5 mm²" },
  { from: "ECU-B.10", to: "CKP.2", fn: "Crank sensor signal −", color: "blue/black", mm: "0.5 mm²" },
  { from: "CKP.3", to: "S2", fn: "Crank sensor shield", color: GND, mm: "0.5 mm²" },
  { from: "S1", to: "CMP.1", fn: "Cam sensor 5 V", color: "grey/white", mm: "0.5 mm²" },
  { from: "CMP.2", to: "S2", fn: "Cam sensor ground", color: GND, mm: "0.5 mm²" },
  { from: "ECU-B.11", to: "CMP.3", fn: "Cam sensor signal", color: "blue/yellow", mm: "0.5 mm²" },
  { from: "S1", to: "MAP.1", fn: "MAP sensor 5 V", color: "grey/yellow", mm: "0.5 mm²" },
  { from: "MAP.2", to: "S2", fn: "MAP sensor ground", color: GND, mm: "0.5 mm²" },
  { from: "ECU-B.12", to: "MAP.3", fn: "Manifold pressure signal", color: "blue/green", mm: "0.5 mm²" },
  { from: "ECU-B.13", to: "MAP.4", fn: "Intake air temperature", color: "blue/red", mm: "0.5 mm²" },
  { from: "ECU-B.14", to: "ECT.1", fn: "Coolant temperature signal", color: "blue/brown", mm: "0.5 mm²" },
  { from: "ECT.2", to: "S2", fn: "Coolant sensor ground", color: GND, mm: "0.5 mm²" },

  /* ---- flying pair, and the two sensors behind it ---- */
  { from: "ECU-B.15", to: "IL-A.1", fn: "Oxygen sensor signal", color: "blue/violet", mm: "0.5 mm²" },
  { from: "IL-A.2", to: "S2", fn: "Oxygen sensor signal ground", color: GND, mm: "0.5 mm²" },
  { from: "IL-A.4", to: "G1", fn: "Oxygen heater ground", color: GND, mm: "1.5 mm²" },
  { from: "ECU-B.16", to: "IL-A.5", fn: "Knock sensor signal", color: "blue/pink", mm: "0.5 mm²" },
  { from: "IL-A.6", to: "S2", fn: "Knock sensor ground", color: GND, mm: "0.5 mm²" },
  { from: "IL-B.1", to: "O2S.1", fn: "Oxygen sensor signal", color: "white/violet", mm: "0.5 mm²" },
  { from: "IL-B.2", to: "O2S.2", fn: "Oxygen sensor signal ground", color: GND, mm: "0.5 mm²" },
  { from: "IL-B.3", to: "O2S.3", fn: "Oxygen heater supply", color: "white/green", mm: "1.5 mm²" },
  { from: "IL-B.4", to: "O2S.4", fn: "Oxygen heater ground", color: GND, mm: "1.5 mm²" },
  { from: "IL-B.5", to: "KS.1", fn: "Knock sensor signal", color: "white/pink", mm: "0.5 mm²" },
  { from: "IL-B.6", to: "KS.2", fn: "Knock sensor ground", color: GND, mm: "0.5 mm²" },

  /* ---- through the bulkhead, into the cabin ---- */
  { from: "BH-C.1", to: "DASH.1", fn: "CAN High", color: "yellow/black", mm: "0.5 mm²" },
  { from: "BH-C.2", to: "DASH.2", fn: "CAN Low", color: "yellow/grey", mm: "0.5 mm²" },
  { from: "BH-C.3", to: "DASH.3", fn: "Malfunction lamp", color: "violet/green", mm: "0.75 mm²" },
  { from: "BH-C.4", to: "DASH.4", fn: "Engine speed to cluster", color: "violet/blue", mm: "0.75 mm²" },
  { from: "DASH.8", to: "BH-C.5", fn: "Ignition switch feed", color: "orange/green", mm: "2.5 mm²" },
  { from: "BH-C.6", to: "DASH.10", fn: "Cluster permanent supply", color: "orange/white", mm: "2.5 mm²" },
  { from: "BH-C.7", to: "DASH.11", fn: "Charge warning lamp", color: "yellow/blue", mm: "0.75 mm²" },
  { from: "DASH.5", to: "DLC.1", fn: "CAN High to diagnostics", color: "yellow/red", mm: "0.5 mm²" },
  { from: "DASH.6", to: "DLC.2", fn: "CAN Low to diagnostics", color: "yellow/white", mm: "0.5 mm²" },
  { from: "DASH.7", to: "DLC.3", fn: "Diagnostic socket supply", color: "orange/red", mm: "1 mm²" },
  { from: "DASH.9", to: "G2", fn: "Cluster ground", color: GND, mm: "1 mm²" },
  { from: "DLC.4", to: "G2", fn: "Diagnostic socket ground", color: GND, mm: "1 mm²" },
];

/** Cavities that are there on the connector and go nowhere. */
const SPARE = { dest: "n.c.", fn: "Spare", color: "-", mm: "-" };

const NOTES: string[] = [
  "Engine harness, 1.4 petrol, four cylinders — sequential injection, coil on plug",
  "Main fuse 40 A within 300 mm of the battery post; fuse and relay box FB in the engine bay",
  "ECU connectors A and B are keyed differently and cannot be swapped",
  "Grounds on M6 studs: G1 on the engine block, G2 and G3 on the body — 9 Nm",
  "Coil and injector supply spliced at S3: ultrasonic weld, sealed with heat-shrink",
  "Sensor 5 V supply spliced at S1, sensor ground at S2",
  "Bulkhead pair BH-E / BH-C: the two halves share one cavity numbering",
  "Oxygen and knock sensors on a flying pair IL-A / IL-B, loomed apart from the injector run",
];

const REVISIONS: string[][] = [
  ["A", "03/03/2026", "0xDevDav", "First issue"],
  ["B", "21/05/2026", "0xDevDav", "Knock sensor moved onto the flying pair"],
  ["C", "14/07/2026", "0xDevDav", "Alternator charge lamp taken through the bulkhead"],
];

/* ============================ building the document ============================ */

/** Both ends of a wire, as the tables write them. */
const endpoints = (w: Wire): [string, string] => [w.from, w.to];

/** The rows of a connector's cavity table, one per cavity, in order. */
function rowsFor(terminal: Terminal): string[][] {
  const rows: string[][] = [];
  for (let cavity = 1; cavity <= (terminal.ways ?? 0); cavity++) {
    const mine = `${terminal.name}.${cavity}`;
    const wire = WIRES.find((w) => endpoints(w).includes(mine));
    if (!wire) {
      rows.push([String(cavity), SPARE.dest, SPARE.fn, SPARE.color, SPARE.mm]);
      continue;
    }
    const other = wire.from === mine ? wire.to : wire.from;
    rows.push([String(cavity), other, wire.fn, wire.color, wire.mm]);
  }
  return rows;
}

export function sampleDoc(t: Translate): HarnessDoc {
  const nodes: HNode[] = [];
  const segments: Segment[] = [];
  const inlines: Inline[] = [];
  const tables: Table[] = [];

  /* ---- the drawing ---- */

  for (const terminal of TERMINALS) {
    nodes.push({
      id: terminal.name,
      x: terminal.x,
      y: terminal.y,
      kind: "connector",
      name: terminal.name,
      style: terminal.style,
      refs: terminal.refs ?? "",
    });
  }
  for (const j of JUNCTIONS) {
    nodes.push({ id: j.id, x: j.x, y: j.y, kind: "junction", name: "", style: "plug", refs: "" });
  }

  const segmentId = (from: string, to: string): string => `w-${from}-${to}`;
  for (const [from, to, len, refs] of BRANCHES) {
    segments.push({ id: segmentId(from, to), a: from, b: to, len, refs: refs ?? "" });
  }
  MARKERS.forEach(([from, to, at, text, color], i) => {
    inlines.push({ id: `m${i + 1}`, seg: segmentId(from, to), t: at, text, color });
  });

  // the two mated pairs: a joint is where one wire ends and the next begins,
  // which is why the colour is free to change across it
  const mate = (a: string, b: string): void => {
    const first = nodes.find((n) => n.id === a);
    const second = nodes.find((n) => n.id === b);
    if (first) first.mate = b;
    if (second) second.mate = a;
  };
  mate("BH-E", "BH-C");
  mate("IL-A", "IL-B");

  /* ---- the tables ---- */

  const head = [
    t("table.head.cavity"),
    t("table.head.dest"),
    t("table.head.function"),
    t("table.head.color"),
    t("table.head.section"),
  ];

  // Every cavity table sits beside the connector it describes, where it was
  // put by hand: a pin-out is read against its own connector, and on a harness
  // this size that is worth deciding rather than working out.
  for (const terminal of TERMINALS) {
    if (!terminal.ways || !terminal.table) continue;
    tables.push({
      id: `t-${terminal.name}`,
      node: terminal.name,
      x: terminal.table.x,
      y: terminal.table.y,
      kind: "table",
      title: terminal.title ?? terminal.name,
      head,
      rows: rowsFor(terminal),
    });
  }

  tables.push({
    id: "notes",
    x: NOTES_AT.x,
    y: NOTES_AT.y,
    kind: "table",
    title: t("table.title.notes"),
    head: [t("table.head.num"), t("table.head.note")],
    rows: NOTES.map((note, i) => [String(i + 1), note]),
  });
  tables.push({
    id: "revisions",
    x: REVISIONS_AT.x,
    y: REVISIONS_AT.y,
    kind: "table",
    title: t("table.title.revisions"),
    head: [t("table.head.rev"), t("table.head.date"), t("table.head.author"), t("table.head.description")],
    rows: REVISIONS,
  });

  tables.push({ id: "title", x: TITLE_AT.x, y: TITLE_AT.y, kind: "title", rows: [] });

  return normalizeDoc({
    meta: {
      title: "Engine harness — 1.4 petrol, four cylinders",
      description: "Sequential injection, coil on plug, CAN link to the cluster and the OBD socket",
      partNumber: "EH-1400.04-C",
      revision: "C",
      company: "Harness Designer",
      drawnBy: "0xDevDav",
      date: new Date().toLocaleDateString(),
    },
    nodes,
    segments,
    inlines,
    tables,
    schematic: SCHEMATIC,
  });
}
