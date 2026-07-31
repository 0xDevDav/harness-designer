/**
 * Reading and writing the length field, which is free text on purpose: a
 * drawing carries "600 mm" next to "to be defined", and forcing a number would
 * make half the real documents unrepresentable.
 */

/** Conversion factors to the millimetre, the drawing's unit. */
const UNITS: Record<string, number> = {
  "": 1, // a bare number: the drawing is dimensioned in millimetres
  mm: 1,
  millimetro: 1,
  millimetri: 1,
  millimeter: 1,
  millimeters: 1,
  cm: 10,
  centimetro: 10,
  centimetri: 10,
  centimeter: 10,
  centimeters: 10,
  dm: 100,
  m: 1000,
  metro: 1000,
  metri: 1000,
  meter: 1000,
  meters: 1000,
  mt: 1000,
  km: 1_000_000,
  in: 25.4,
  inch: 25.4,
  inches: 25.4,
  pollice: 25.4,
  pollici: 25.4,
  '"': 25.4,
  ft: 304.8,
  feet: 304.8,
  foot: 304.8,
  piede: 304.8,
  piedi: 304.8,
  "'": 304.8,
  yd: 914.4,
  yard: 914.4,
  yards: 914.4,
};

/**
 * Millimetres from a free-text length, or `null` when the value is not a
 * measurement. Anything unrecognized is rejected quietly: a note reading
 * "to be defined" is not a typo waiting to be corrected.
 */
export function parseLengthMm(value: string | undefined): number | null {
  if (typeof value !== "string") return null;
  const raw = value.trim().toLowerCase().replace(/\s+/g, " ");
  if (!raw) return null;
  const m = /^([0-9]+(?:[.,][0-9]+)?)\s*([a-z"'µ]*)\.?$/.exec(raw);
  if (!m?.[1]) return null;
  const amount = Number(m[1].replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const factor = UNITS[m[2] ?? ""];
  return factor === undefined ? null : amount * factor;
}

/**
 * Millimetres back to text, in the unit a workshop reads: millimetres up to a
 * metre, metres above it. Trailing zeros are dropped because "1.5 m" is a
 * length and "1.50 m" is a false claim about precision.
 */
export function formatLengthMm(mm: number): string {
  if (!Number.isFinite(mm) || mm <= 0) return "";
  if (mm < 1000) return `${round(mm, 1)} mm`;
  return `${round(mm / 1000, 3)} m`;
}

const round = (v: number, decimals: number): string =>
  String(Number(v.toFixed(decimals)));
