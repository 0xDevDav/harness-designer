import { safeGet, safeSet } from "@/io/storage";

/**
 * Tema dell'interfaccia.
 *
 * Three choices: light, dark, or "match system", which is the default. If the
 * user has already told the operating system how they want to work, there is
 * no reason to ask again.
 *
 * The **drawing sheet stays light in both themes**: it is the paper of a
 * technical drawing, and what you see has to match what gets printed and
 * exported. Everything around it changes instead.
 */

export const THEMES = ["auto", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

const STORAGE_KEY = "harness.theme";
const listeners = new Set<(theme: Theme) => void>();

let current: Theme = "auto";

const media = (): MediaQueryList | null =>
  typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

/** The theme actually applied, resolving "auto" against the system preference. */
export function resolvedTheme(): Exclude<Theme, "auto"> {
  if (current !== "auto") return current;
  return media()?.matches ? "dark" : "light";
}

export function getTheme(): Theme {
  return current;
}

function apply(): void {
  const resolved = resolvedTheme();
  const root = document.documentElement;
  root.dataset["theme"] = resolved;
  root.style.colorScheme = resolved;
  // the mobile browser chrome follows the interface colour
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", resolved === "dark" ? "#0b0b0f" : "#f2f3f7");
  for (const fn of listeners) fn(current);
}

export function setTheme(theme: Theme): void {
  if (!THEMES.includes(theme)) return;
  current = theme;
  safeSet(STORAGE_KEY, theme);
  apply();
}

export function onThemeChange(fn: (theme: Theme) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Call once at startup, before building the interface. */
export function initTheme(): void {
  const saved = safeGet(STORAGE_KEY);
  current = THEMES.includes(saved as Theme) ? (saved as Theme) : "auto";
  apply();
  // when the choice is "match system", the change has to be followed live
  media()?.addEventListener("change", () => {
    if (current === "auto") apply();
  });
}
