import { safeGet, safeSet } from "@/io/storage";

/**
 * Which of the two readings of the harness is on screen.
 *
 * `board` is the formboard, the drawing that goes to the workshop. `schematic`
 * is the same harness read as circuits. `split` shows both, and is the reason
 * the pair is worth having: picking something in one view lights up what it is
 * in the other, which is the question nobody could answer without holding two
 * sheets of paper side by side.
 *
 * It is a setting of the program and not a property of the drawing — it says
 * how somebody is working right now, not what the harness is — so it is kept
 * next to the theme and the language, and it is not saved into the file.
 */

export const VIEW_MODES = ["board", "schematic", "split"] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

const STORAGE_KEY = "harness.view";
const listeners = new Set<(mode: ViewMode) => void>();

let current: ViewMode = "board";
let host: HTMLElement | null = null;

export const getViewMode = (): ViewMode => current;

export const showsBoard = (): boolean => current !== "schematic";
export const showsSchematic = (): boolean => current !== "board";

function apply(): void {
  if (host) host.dataset["view"] = current;
  for (const fn of listeners) fn(current);
}

export function setViewMode(mode: ViewMode): void {
  if (!VIEW_MODES.includes(mode) || mode === current) return;
  current = mode;
  safeSet(STORAGE_KEY, mode);
  apply();
}

/** Next mode in the list, so one key can go round all three. */
export function cycleViewMode(): void {
  setViewMode(VIEW_MODES[(VIEW_MODES.indexOf(current) + 1) % VIEW_MODES.length]!);
}

export function onViewModeChange(fn: (mode: ViewMode) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Call once at startup, with the element that holds the two views. */
export function initViewMode(container: HTMLElement): void {
  host = container;
  const saved = safeGet(STORAGE_KEY);
  current = VIEW_MODES.includes(saved as ViewMode) ? (saved as ViewMode) : "board";
  apply();
}
