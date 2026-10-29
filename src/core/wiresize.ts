import { tableColumns } from "./doc";
import type { HarnessDoc, Table, WireUnit } from "./types";

/**
 * Wire sizes, in metric cross-section or in American Wire Gauge, and the
 * conversion between the two.
 *
 * The two scales do not line up: a 1.5 mm² wire is not any AWG size, it is
 * between 16 and 14. So converting always lands on the nearest *standard* size
 * of the other scale, which is what a person reading a wire list would pick, and
 * converting back need not return the size you started with.
 */

export const WIRE_UNITS: readonly WireUnit[] = ["mm2", "awg"];

/** What the Section column is headed once the drawing has a unit. */
export const unitLabel = (unit: WireUnit): string => (unit === "awg" ? "AWG" : "mm²");

/** One size on one of the scales: the text a cell holds, and the copper it stands for. */
export interface WireSize {
  label: string;
  /** conductor cross-section in mm², which is what the two scales are compared by */
  area: number;
}

/** The metric sizes automotive wire is sold in (ISO 6722), plus the 0.22 used for data lines. */
const MM2_SIZES = [0.22, 0.35, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 16, 25, 35, 50, 70, 95];

/** The gauges in common use, finest first. "1/0" and up are written the way they are said. */
const AWG_GAUGES: ReadonlyArray<{ label: string; n: number }> = [
  { label: "24", n: 24 },
  { label: "22", n: 22 },
  { label: "20", n: 20 },
  { label: "18", n: 18 },
  { label: "16", n: 16 },
  { label: "14", n: 14 },
  { label: "12", n: 12 },
  { label: "10", n: 10 },
  { label: "8", n: 8 },
  { label: "6", n: 6 },
  { label: "4", n: 4 },
  { label: "2", n: 2 },
  { label: "1", n: 1 },
  { label: "1/0", n: 0 },
  { label: "2/0", n: -1 },
  { label: "3/0", n: -2 },
  { label: "4/0", n: -3 },
];

/**
 * Cross-section of gauge n. The gauge is defined by the diameter, which runs
 * from 0.4600 in at 4/0 to 0.0050 in at 36 in 39 steps of a constant ratio.
 */
export function awgArea(n: number): number {
  const diameter = 0.127 * Math.pow(92, (36 - n) / 39);
  return (Math.PI / 4) * diameter * diameter;
}

const SIZES: Record<WireUnit, readonly WireSize[]> = {
  mm2: MM2_SIZES.map((area) => ({ label: String(area), area })),
  awg: AWG_GAUGES.map(({ label, n }) => ({ label, area: awgArea(n) })),
};

/** The sizes offered for a unit, finest first. */
export const sizesFor = (unit: WireUnit): readonly WireSize[] => SIZES[unit];

/** The standard size of `unit` closest to the given copper area, closeness being a ratio, not a difference. */
export function nearestSize(area: number, unit: WireUnit): WireSize {
  let best = SIZES[unit][0] as WireSize;
  let bestGap = Infinity;
  for (const size of SIZES[unit]) {
    const gap = Math.abs(Math.log(size.area / area));
    if (gap < bestGap) {
      best = size;
      bestGap = gap;
    }
  }
  return best;
}

/** What a cell says, read as a wire size. */
export interface ParsedSize {
  /** the number as it was typed, without any unit */
  figure: string;
  /** the unit the cell names itself, if it does */
  unit?: WireUnit;
  area: number;
}

const AUGHT = /^(\d)\/0$/;

/**
 * Reads "1.5", "0,75 mm²", "18 AWG", "AWG 16", "1/0". `fallback` is the unit a
 * bare number is in. Anything else ("2x0.5 shielded", "see note") is not a size
 * and gives null, so it is never rewritten.
 */
export function parseSize(text: string, fallback: WireUnit): ParsedSize | null {
  const s = text.trim().toLowerCase().replace(/\s+/g, " ");
  const m =
    /^(?<n>\d+(?:[.,]\d+)?|\d\/0)(?: ?(?<u>mm ?[²2]|sq ?mm|awg|ga|gauge))?$/.exec(s) ??
    /^(?<u>awg|ga|gauge) ?(?<n>\d+|\d\/0)$/.exec(s);
  const figure = m?.groups?.["n"];
  if (!figure) return null;

  const named = m.groups?.["u"];
  // "1/0" only exists as a gauge, whatever unit the drawing is in
  const aught = AUGHT.exec(figure);
  const unit: WireUnit | undefined = named
    ? named.startsWith("mm") || named.startsWith("sq")
      ? "mm2"
      : "awg"
    : aught
      ? "awg"
      : undefined;
  const withUnit = unit ? { unit } : {};

  if ((unit ?? fallback) === "awg") {
    const n = aught ? 1 - Number(aught[1]) : Number(figure.replace(",", "."));
    if (!Number.isInteger(n) || n > 40) return null;
    return { figure, ...withUnit, area: awgArea(n) };
  }
  const area = Number(figure.replace(",", "."));
  if (!(area > 0)) return null;
  return { figure, ...withUnit, area };
}

/**
 * The unit the drawing's sizes are in. A drawing that has been given one says
 * so; an older one is read from how its Section column is headed, and failing
 * that is taken to be metric.
 */
export function wireUnitOf(doc: HarnessDoc): WireUnit {
  if (doc.wireUnit) return doc.wireUnit;
  for (const table of doc.tables) {
    const col = sizeColumn(table);
    const unit = col === undefined ? undefined : headingUnit(table.head?.[col]);
    if (unit) return unit;
  }
  return "mm2";
}

/** The unit a heading names ("AWG", "Gauge", "mm²"), or nothing when it is just "Section". */
function headingUnit(heading: string | undefined): WireUnit | undefined {
  const h = (heading ?? "").toLowerCase();
  if (/awg|gauge/.test(h)) return "awg";
  if (/mm/.test(h)) return "mm2";
  return undefined;
}

/** The headings of a wire list, in the two languages the application is written in. */
const WIRE_LIST_HEADS = [/^(from|da)$/i, /^(to|a)$/i, /^(length|lunghezza)$/i];

/**
 * The tables whose Section column is a wire size: the cavity tables and the
 * wire list. Any other table that happens to have a column of that name is
 * somebody's own, and is not renamed or converted.
 */
function sizeColumn(table: Table): number | undefined {
  if (table.kind !== "table" || !table.head) return undefined;
  const cols = tableColumns(table);
  if (cols.section === undefined) return undefined;
  const head = table.head;
  const wireList = WIRE_LIST_HEADS.every((re) => head.some((h) => re.test(h.trim())));
  return cols.cavity !== undefined || wireList ? cols.section : undefined;
}

export interface UnitChange {
  /** sizes rewritten into the new unit */
  converted: number;
  /** cells that hold something other than a size, and so were left as typed */
  skipped: number;
}

/**
 * Switches the whole drawing to `unit`: every table with a Section column gets
 * the unit for its heading and every size in it is converted, so the sheet, the
 * wire list and the export all say the same thing.
 *
 * A bare number is taken to be in the unit the drawing is in now (or in `read`,
 * when the sizes are known to be in another), and is only rewritten when that
 * differs from the new one — a size somebody typed that is not a standard one
 * (0.6) survives a switch to the unit it is already in. A table whose heading
 * names a unit is read in that unit, whatever the drawing is in: a table pasted
 * from another drawing headed "AWG" holds gauges.
 */
export function setWireUnit(doc: HarnessDoc, unit: WireUnit, read?: WireUnit): UnitChange {
  const current = read ?? wireUnitOf(doc);
  const change: UnitChange = { converted: 0, skipped: 0 };

  for (const table of doc.tables) {
    const col = sizeColumn(table);
    if (!table.head || col === undefined) continue;

    const from = headingUnit(table.head[col]) ?? current;
    table.head[col] = unitLabel(unit);
    for (const row of table.rows) {
      const text = row[col] ?? "";
      if (!text.trim()) continue;
      const size = parseSize(text, from);
      if (!size) {
        change.skipped++;
        continue;
      }
      if ((size.unit ?? from) === unit) {
        // already in the unit: only a stray suffix ("18 AWG") is tidied away
        if (size.unit && row[col] !== size.figure) {
          row[col] = size.figure;
          change.converted++;
        }
        continue;
      }
      row[col] = nearestSize(size.area, unit).label;
      change.converted++;
    }
  }
  // the default size is a size like any other
  const kept = doc.defaults?.size;
  if (doc.defaults && kept) {
    const size = parseSize(kept, current);
    if (size && (size.unit ?? current) !== unit) doc.defaults.size = nearestSize(size.area, unit).label;
    else if (size?.unit) doc.defaults.size = size.figure;
  }
  doc.wireUnit = unit;
  return change;
}

/** One size that a change of unit would turn into another, and how many cells it is written in. */
export interface SizeChange {
  /** as written, with its unit: "2.5 mm²" */
  from: string;
  /** what it would become: "14 AWG" */
  to: string;
  count: number;
  /** copper of the result over copper of the original: 0.83 is a wire 17 % thinner */
  ratio: number;
}

/** A conversion that moves the copper by less than this is the same wire for anyone's purposes. */
const SAME_WIRE = 0.01;

/**
 * What switching to `unit` would do to the sizes, without doing it: every size
 * that would be rewritten, grouped, thinner ones first. The two scales do not
 * line up (2.5 mm² is between 14 and 12 AWG), so a conversion is a rounding,
 * and a wire that comes out thinner than it was drawn is something to be told
 * about before it happens, not after. Sizes that come out within 1 % of what
 * they were are left out: they are the same wire.
 */
export function previewUnitChange(doc: HarnessDoc, unit: WireUnit): SizeChange[] {
  const current = wireUnitOf(doc);
  const groups = new Map<string, SizeChange>();
  const note = (text: string, from: WireUnit): void => {
    const size = parseSize(text, from);
    if (!size || (size.unit ?? from) === unit) return;
    const target = nearestSize(size.area, unit);
    const ratio = target.area / size.area;
    if (Math.abs(ratio - 1) < SAME_WIRE) return;
    const change: SizeChange = {
      from: `${size.figure} ${unitLabel(size.unit ?? from)}`,
      to: `${target.label} ${unitLabel(unit)}`,
      count: 1,
      ratio,
    };
    const key = `${change.from}>${change.to}`;
    const seen = groups.get(key);
    if (seen) seen.count++;
    else groups.set(key, change);
  };
  for (const table of doc.tables) {
    const col = sizeColumn(table);
    if (!table.head || col === undefined) continue;
    const from = headingUnit(table.head[col]) ?? current;
    for (const row of table.rows) note(row[col] ?? "", from);
  }
  // the size a new wire starts from is rounded like the others, so the window lists it too
  if (doc.defaults?.size) note(doc.defaults.size, current);
  return [...groups.values()].sort((a, b) => a.ratio - b.ratio || a.from.localeCompare(b.from));
}

/** The heading a new table's Section column gets: the unit if the drawing has one, else the plain word. */
export const sectionHeading = (unit: WireUnit | undefined, fallback: string): string =>
  unit ? unitLabel(unit) : fallback;

/** Whether switching to `unit` would write anything: the same switch made on a copy. */
export function wouldChangeUnit(doc: HarnessDoc, unit: WireUnit): boolean {
  const copy = structuredClone(doc);
  setWireUnit(copy, unit);
  return JSON.stringify(copy) !== JSON.stringify(doc);
}

/**
 * Sizes written as bare numbers that are not standard in the unit the drawing
 * is read in, but are standard in `unit`: an older drawing that keeps gauges
 * under a plain "Section" says so by having an 18 or a 22 in it. Only for a
 * drawing that has not been given a unit, and only under headings that name
 * none, since a heading that names one already says what the numbers are.
 */
export function sizesAlreadyIn(doc: HarnessDoc, unit: WireUnit): string[] {
  if (doc.wireUnit) return [];
  const current = wireUnitOf(doc);
  if (current === unit) return [];
  const standard = (u: WireUnit, figure: string): boolean =>
    SIZES[u].some((size) => size.label === figure.replace(",", "."));
  const found = new Set<string>();
  for (const table of doc.tables) {
    const col = sizeColumn(table);
    if (!table.head || col === undefined || headingUnit(table.head[col])) continue;
    for (const row of table.rows) {
      const size = parseSize(row[col] ?? "", current);
      if (!size || size.unit) continue;
      if (!standard(current, size.figure) && standard(unit, size.figure)) found.add(size.figure);
    }
  }
  return [...found];
}
