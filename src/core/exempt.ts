import { wireColorKey } from "./colors";
import type { HarnessDoc } from "./types";

/**
 * Colours the two-ends rule leaves out, the way plain black is left out for
 * being ground: a +12 V feed or a sensor supply may run in one colour to as
 * many connectors as the harness needs.
 *
 * The list goes by colour and never by wire, because the rule counts colours:
 * leaving out one red wire would still leave every other red one counted, and
 * the error would not go away. It is kept in the drawing, so the next person to
 * open the file gets the same check.
 */

/** The list read from a file: one entry per colour, only what reads as a colour. */
export function normalizeExemptColors(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of raw) {
    const color = typeof value === "string" ? value.trim() : "";
    const key = wireColorKey(color);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(color);
  }
  return out.length ? out : undefined;
}

/** Fingerprints of the colours left out, to compare a cell against. */
export function exemptColorKeys(doc: HarnessDoc): Set<string> {
  const keys = new Set<string>();
  for (const color of doc.exemptColors ?? []) {
    const key = wireColorKey(color);
    if (key) keys.add(key);
  }
  return keys;
}

/** Puts a colour on the list or takes it off. Mutates the document. */
export function setColorExempt(doc: HarnessDoc, color: string, exempt: boolean): void {
  const key = wireColorKey(color);
  if (!key) return;
  const current = doc.exemptColors ?? [];
  const others = current.filter((c) => wireColorKey(c) !== key);
  if (exempt && others.length < current.length) return;
  const list = normalizeExemptColors(exempt ? [...others, color] : others);
  if (list) doc.exemptColors = list;
  else delete doc.exemptColors;
}
