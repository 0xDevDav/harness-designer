/**
 * Wire colours. Names are recognized in Italian and in English, and plugins can
 * add more (for instance DIN 47002 codes: SW, RT, GE…).
 */
const BASE_COLORS: Record<string, string> = {
  rosso: "#c62828",
  red: "#c62828",
  nero: "#111111",
  black: "#111111",
  verde: "#2e9e3f",
  green: "#2e9e3f",
  blu: "#1d4fd7",
  blue: "#1d4fd7",
  azzurro: "#4a9fe0",
  lightblue: "#4a9fe0",
  marrone: "#7a4b22",
  brown: "#7a4b22",
  arancio: "#e88a1a",
  arancione: "#e88a1a",
  orange: "#e88a1a",
  bianco: "#ffffff",
  white: "#ffffff",
  giallo: "#e6c700",
  yellow: "#e6c700",
  grigio: "#9e9e9e",
  gray: "#9e9e9e",
  grey: "#9e9e9e",
  viola: "#7b1fa2",
  purple: "#7b1fa2",
  violet: "#7b1fa2",
  rosa: "#e57fb3",
  pink: "#e57fb3",
  beige: "#e6d3b3",
  tan: "#d8b98e",
  oro: "#c9a227",
  gold: "#c9a227",
  argento: "#c0c4c8",
  silver: "#c0c4c8",
  trasparente: "#e8ecf0",
  clear: "#e8ecf0",
};

/**
 * Standard wiring colour palette: IEC 60757 codes (the first) and DIN 47002
 * (the second, used by European components). This is the list behind the colour
 * picker; `it` and `en` are the texts actually written into the cell, and both
 * are recognized by `colorOf`.
 */
export interface WireColor {
  /** stable identifier, independent of language */
  key: string;
  hex: string;
  /** IEC 60757 code */
  code: string;
  /** DIN 47002 code, where it differs */
  din?: string;
  it: string;
  en: string;
}

export const WIRE_PALETTE: readonly WireColor[] = [
  { key: "black", hex: "#111111", code: "BK", din: "SW", it: "nero", en: "black" },
  { key: "brown", hex: "#7a4b22", code: "BN", din: "BR", it: "marrone", en: "brown" },
  { key: "red", hex: "#c62828", code: "RD", din: "RT", it: "rosso", en: "red" },
  { key: "orange", hex: "#e88a1a", code: "OG", din: "OR", it: "arancio", en: "orange" },
  { key: "yellow", hex: "#e6c700", code: "YE", din: "GE", it: "giallo", en: "yellow" },
  { key: "green", hex: "#2e9e3f", code: "GN", it: "verde", en: "green" },
  { key: "blue", hex: "#1d4fd7", code: "BU", din: "BL", it: "blu", en: "blue" },
  { key: "lightblue", hex: "#4a9fe0", code: "LBU", din: "HBL", it: "azzurro", en: "lightblue" },
  { key: "violet", hex: "#7b1fa2", code: "VT", din: "VI", it: "viola", en: "violet" },
  { key: "grey", hex: "#9e9e9e", code: "GY", din: "GR", it: "grigio", en: "grey" },
  { key: "white", hex: "#ffffff", code: "WH", din: "WS", it: "bianco", en: "white" },
  { key: "pink", hex: "#e57fb3", code: "PK", din: "RS", it: "rosa", en: "pink" },
  { key: "turquoise", hex: "#12a4a4", code: "TQ", it: "turchese", en: "turquoise" },
  { key: "beige", hex: "#e6d3b3", code: "BEI", it: "beige", en: "beige" },
  { key: "gold", hex: "#c9a227", code: "GD", it: "oro", en: "gold" },
  { key: "silver", hex: "#c0c4c8", code: "SR", it: "argento", en: "silver" },
  { key: "clear", hex: "#e8ecf0", code: "CL", it: "trasparente", en: "clear" },
];

const custom = new Map<string, string>();

// standard codes are recognized just like full names: "ws/ge" means "white/yellow"
const CODES: Record<string, string> = {};
for (const c of WIRE_PALETTE) {
  CODES[c.code.toLowerCase()] = c.hex;
  if (c.din) CODES[c.din.toLowerCase()] = c.hex;
  // Every palette name has to be readable back, otherwise picking a colour
  // would write a word into the cell that nothing can resolve, and the swatch
  // would come out empty. Deriving them here keeps the two lists from drifting
  // apart, which is exactly how turquoise ended up unrecognized.
  BASE_COLORS[c.it] ??= c.hex;
  BASE_COLORS[c.en] ??= c.hex;
}

/** Palette entry matching a written value, when it can be recognized. */
export function wireColorOf(value: string): WireColor | undefined {
  const hex = colorOf(value);
  return hex ? WIRE_PALETTE.find((c) => c.hex === hex) : undefined;
}

/** Colours that stand for ground: exempt from the two-ends rule. */
export const GROUND_HEX = new Set(["#111111", "#000000", "#000"]);

/** True for plain black, the ground conductor that may legitimately be bridged. */
export function isGroundColor(value: unknown): boolean {
  const bands = colorsOf(value);
  return !!bands && bands.length === 1 && GROUND_HEX.has(bands[0]!);
}

/**
 * Fingerprint of a wire, independent of language and codes: "Bianco/Giallo",
 * "bianco,giallo" and "WS/GE" all produce the same key, while band order stays
 * significant because it tells the base colour from the tracer.
 */
export function wireColorKey(value: unknown): string | null {
  const bands = colorsOf(value);
  return bands ? bands.join("|") : null;
}

/** Registers an extra colour name (used by the plugin API). */
export function registerColorName(name: string, hex: string): void {
  custom.set(name.trim().toLowerCase(), hex);
}

/** List of recognized names, for suggestions in the interface. */
export function knownColorNames(): string[] {
  return [...new Set([...Object.keys(BASE_COLORS), ...custom.keys()])].sort();
}

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/;

/** Reads a single value: a known name or a #hex. */
export function colorOf(value: unknown): string | null {
  if (value == null) return null;
  const t = String(value).trim().toLowerCase();
  if (!t) return null;
  if (HEX_RE.test(t)) return t;
  return custom.get(t) ?? BASE_COLORS[t] ?? CODES[t] ?? null;
}

/**
 * Reads a multi-part value ("rosso,blu" · "marrone/bianco" · "ge+sw") and
 * returns the bands of the swatch. Returns null if even one part is not a
 * recognized colour: a cell of prose must never turn into a swatch.
 */
export function colorsOf(value: unknown): string[] | null {
  if (value == null) return null;
  const parts = String(value)
    .split(/[,/+]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length || parts.length > 4) return null;
  const out: string[] = [];
  for (const p of parts) {
    const c = colorOf(p);
    if (!c) return null;
    out.push(c);
  }
  return out;
}

/** Light colours, the ones dark text stays readable on. */
export function isLightColor(hex: string): boolean {
  const h = colorOf(hex) ?? "#888888";
  const full = h.length === 4 ? `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}` : h;
  const r = parseInt(full.slice(1, 3), 16);
  const g = parseInt(full.slice(3, 5), 16);
  const b = parseInt(full.slice(5, 7), 16);
  // perceived luminance
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62;
}
