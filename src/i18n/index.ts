import { it } from "./it";
import { en } from "./en";

/** Reference dictionary: Italian defines the set of keys. */
export type MessageKey = keyof typeof it;
export type Messages = Record<string, string>;
export type Params = Record<string, string | number>;

/** Translation function handed to rules, commands and plugins. */
export type Translate = (key: MessageKey | (string & {}), params?: Params) => string;

export const LOCALES = ["it", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_NAMES: Record<Locale, string> = { it: "Italiano", en: "English" };

const bundles: Record<Locale, Messages> = { it: { ...it }, en: { ...en } };

let current: Locale = "it";
const listeners = new Set<(locale: Locale) => void>();

const STORAGE_KEY = "harness.locale";

/** Initial locale: saved preference, then browser language, then Italian. */
export function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && (LOCALES as readonly string[]).includes(saved)) return saved as Locale;
  } catch {
    /* storage unavailable: carry on with the browser language */
  }
  const nav = typeof navigator !== "undefined" ? navigator.language.toLowerCase() : "it";
  return nav.startsWith("en") ? "en" : "it";
}

export function getLocale(): Locale {
  return current;
}

export function setLocale(locale: Locale): void {
  if (!(LOCALES as readonly string[]).includes(locale) || locale === current) return;
  current = locale;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* preference cannot be stored: it still holds for this session */
  }
  if (typeof document !== "undefined") document.documentElement.lang = locale;
  for (const fn of listeners) fn(locale);
}

export function onLocaleChange(fn: (locale: Locale) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Adds or overwrites messages, used by plugins for their own strings.
 * By convention a plugin's keys look like `plugin.<id>.<name>`.
 */
export function addMessages(locale: Locale, messages: Messages): void {
  Object.assign(bundles[locale], messages);
  for (const fn of listeners) fn(current);
}

const interpolate = (template: string, params?: Params): string =>
  params
    ? template.replace(/\{(\w+)\}/g, (_m, k: string) => (k in params ? String(params[k]) : `{${k}}`))
    : template;

/**
 * Translates a key. If it is missing from the active locale it falls back to
 * Italian and, in the last resort, returns the key itself: an untranslated
 * message must never make information vanish from the interface.
 */
export const t: Translate = (key, params) => {
  const message = bundles[current][key] ?? bundles.it[key];
  if (message === undefined) {
    if (import.meta.env?.DEV) console.warn(`[i18n] missing key: ${key}`);
    return String(key);
  }
  return interpolate(message, params);
};

/** Keys missing from a locale, used by the tests. */
export function missingKeys(locale: Locale): string[] {
  return Object.keys(bundles.it).filter((k) => bundles[locale][k] === undefined);
}
