import { it } from "./it";
import { en } from "./en";

/** Reference dictionary: Italian defines the set of keys. */
export type MessageKey = keyof typeof it;
export type Messages = Record<string, string>;
export type Params = Record<string, string | number>;

/** Translation function handed to rules, commands and plugins. */
export type Translate = (key: MessageKey | (string & {}), params?: Params) => string;

/** The two languages that ship with the application. Plugins can add more. */
export const BUILTIN_LOCALES = ["it", "en"] as const;

/**
 * A language code. The built-in ones are listed so they autocomplete, but the
 * type stays open: the set is decided at runtime, not at compile time.
 */
export type Locale = (typeof BUILTIN_LOCALES)[number] | (string & {});

const bundles: Record<string, Messages> = { it: { ...it }, en: { ...en } };
const names: Record<string, string> = { it: "Italiano", en: "English" };

/**
 * Every language currently available, in registration order. Read it rather
 * than caching it: a plugin can add one at any moment, and the language menu is
 * rebuilt from this.
 */
export function locales(): Locale[] {
  return Object.keys(bundles);
}

export function localeName(locale: Locale): string {
  return names[locale] ?? locale;
}

let current: Locale = "it";
const listeners = new Set<(locale: Locale) => void>();

const STORAGE_KEY = "harness.locale";

const savedLocale = (): string | null => {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    /* storage unavailable: carry on with the browser language */
    return null;
  }
};

/** Initial locale: saved preference, then browser language, then Italian. */
export function detectLocale(): Locale {
  const saved = savedLocale();
  if (saved && saved in bundles) return saved;
  const nav = typeof navigator !== "undefined" ? navigator.language.toLowerCase() : "it";
  const match = locales().find((l) => nav.startsWith(l));
  return match ?? "it";
}

export function getLocale(): Locale {
  return current;
}

export function setLocale(locale: Locale): void {
  if (!(locale in bundles) || locale === current) return;
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
 * Adds a language, or replaces the messages of one already there.
 *
 * `name` is what the language menu shows, and it is written in that language:
 * somebody looking for their own tongue is not reading the current one.
 *
 * Plugins load after startup, so a language registered here may be the one the
 * user had chosen before: if the saved preference matches, it is applied now
 * rather than leaving them on the fallback until they pick it again.
 */
export function registerLocale(locale: Locale, name: string, messages: Messages): void {
  const known = locale in bundles;
  bundles[locale] = { ...(bundles[locale] ?? {}), ...messages };
  names[locale] = name;
  if (!known && savedLocale() === locale) setLocale(locale);
  else for (const fn of listeners) fn(current);
}

/**
 * Adds or overwrites messages, used by plugins for their own strings.
 * By convention a plugin's keys look like `plugin.<id>.<name>`.
 *
 * An unknown language is created rather than refused: a plugin that ships its
 * strings before the language they belong to would otherwise fail silently.
 */
export function addMessages(locale: Locale, messages: Messages): void {
  bundles[locale] = { ...(bundles[locale] ?? {}), ...messages };
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
  const message = bundles[current]?.[key] ?? bundles["it"]?.[key];
  if (message === undefined) {
    if (import.meta.env?.DEV) console.warn(`[i18n] missing key: ${key}`);
    return String(key);
  }
  return interpolate(message, params);
};

/** Keys missing from a locale, used by the tests. */
export function missingKeys(locale: Locale): string[] {
  const bundle = bundles[locale] ?? {};
  return Object.keys(bundles["it"] ?? {}).filter((k) => bundle[k] === undefined);
}
