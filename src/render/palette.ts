/**
 * Drawing colours.
 *
 * The sheet has two guises: **paper**, the usual one, and **dark**, which
 * follows the interface theme because a white sheet in a dark room is blinding.
 *
 * One rule never changes: **export and print always use paper**. A harness
 * drawing ends up on an A3 sheet in a workshop, not on a screen, and nobody
 * prints a black background. The renderer forces paper with `withPaper(...)`
 * when it produces the SVG to export.
 *
 * Termination symbols (plug, ring, faston, splice) keep their own colours in
 * both guises: they stand for physical objects, and recognizing them at a
 * colpo d'occhio conta più dell'uniformità cromatica.
 */

export interface DrawingPalette {
  /** sheet background */
  paper: string;
  /** reticolo */
  grid: string;
  /** bundle outline */
  bundleOuter: string;
  /** inside of the bundle, the "tube" */
  bundleInner: string;
  /** text of nodes and of labels on the sheet */
  text: string;
  /** secondary text of the title block */
  textDim: string;
  /** table background */
  tableBg: string;
  /** table header */
  tableHeadBg: string;
  /** table title row */
  tableTitleBg: string;
  /** outer table border */
  tableBorder: string;
  /** inner table rules */
  tableLine: string;
  /** outline of the colour swatches */
  swatchBorder: string;
  /** row in error, from the two-ends rule */
  errorFill: string;
  errorStroke: string;
  /** selection highlight */
  selection: string;
  /** company mark in the title block */
  company: string;
}

const PAPER: DrawingPalette = {
  paper: "#f4f6f9",
  grid: "#dfe5ee",
  bundleOuter: "#8f9aa8",
  bundleInner: "#ffffff",
  text: "#222222",
  textDim: "#888888",
  tableBg: "#ffffff",
  tableHeadBg: "#eef1f5",
  tableTitleBg: "#e3e8ef",
  tableBorder: "#5b6773",
  tableLine: "#9aa4b0",
  swatchBorder: "#555555",
  errorFill: "#ffe3e3",
  errorStroke: "#c62828",
  selection: "#3d8bfd",
  company: "#1d5fb8",
};

const DARK: DrawingPalette = {
  paper: "#15171d",
  // barely there: on a dark background a strong grid dazzles and hides the line
  grid: "#1c1f27",
  bundleOuter: "#79828f",
  bundleInner: "#252932",
  text: "#e8eaf0",
  textDim: "#8b93a3",
  tableBg: "#1b1e26",
  tableHeadBg: "#242832",
  tableTitleBg: "#2a2f3a",
  tableBorder: "#3d4453",
  tableLine: "#333a47",
  swatchBorder: "#8b93a3",
  errorFill: "#3a2126",
  errorStroke: "#ef5b6b",
  selection: "#6d5cff",
  company: "#8b7bff",
};

let active: DrawingPalette = PAPER;
let screen: DrawingPalette = PAPER;

/** Palette in use: the drawing modules read it on every stroke. */
export const palette = (): DrawingPalette => active;

/** Sets the on-screen guise from the interface theme. */
export function setDrawingTheme(theme: "light" | "dark"): void {
  screen = theme === "dark" ? DARK : PAPER;
  active = screen;
}

/**
 * Runs a function in the paper guise whatever the theme, which is what makes
 * export and print independent of how you happen to be working.
 */
export function withPaper<T>(fn: () => T): T {
  const previous = active;
  active = PAPER;
  try {
    return fn();
  } finally {
    active = previous;
  }
}
