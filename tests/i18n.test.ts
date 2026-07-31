import { afterAll, describe, expect, test, vi } from "vitest";
import { it } from "@/i18n/it";
import { addMessages, getLocale, locales, missingKeys, registerLocale, setLocale, t } from "@/i18n";
import { it as messagesIt } from "@/i18n/it";
import { en as messagesEn } from "@/i18n/en";

/**
 * The keys are captured when the module loads, so the tests that add messages,
 * for fallback or plugins, cannot skew the comparison between dictionaries.
 */
const missingInEnglish = missingKeys("en");

afterAll(() => {
  setLocale("it");
});

describe("dictionary coverage", () => {
  test("no Italian key is missing from English", () => {
    expect(missingInEnglish).toEqual([]);
  });

  test("no English key exists beyond the Italian ones", () => {
    const extra = Object.keys(messagesEn).filter((k) => !(k in messagesIt));
    expect(extra).toEqual([]);
  });

  test("no message is empty", () => {
    const vuote = [...Object.entries(messagesIt), ...Object.entries(messagesEn)]
      .filter(([, value]) => String(value).trim() === "")
      .map(([key]) => key);
    expect(vuote).toEqual([]);
  });

  test("parameter placeholders match across the two languages", () => {
    const placeholders = (s: string): string[] => (s.match(/\{\w+\}/g) ?? []).sort();
    const diverse: string[] = [];
    for (const [key, valueIt] of Object.entries(messagesIt)) {
      const valueEn = (messagesEn as Record<string, string>)[key];
      if (valueEn === undefined) continue;
      const a = placeholders(valueIt);
      const b = placeholders(valueEn);
      if (a.join(",") !== b.join(",")) diverse.push(key);
    }
    expect(diverse).toEqual([]);
  });

  test("missingKeys answers for every declared locale", () => {
    for (const locale of locales()) {
      expect(Array.isArray(missingKeys(locale))).toBe(true);
    }
    expect(missingKeys("it")).toEqual([]);
  });
});

describe("translation", () => {
  test("interpolates the parameters", () => {
    expect(t("validate.nodeLabel", { name: "C13" })).toBe("Nodo C13");
    expect(t("validate.duplicateCavity", { owner: "C13", cavity: 4 })).toBe("C13: cavità 4 duplicata");
  });

  test("leaves the placeholder untouched when the parameter was not passed", () => {
    expect(t("validate.nodeLabel")).toBe("Nodo {name}");
    expect(t("validate.nodeLabel", { altro: "x" })).toBe("Nodo {name}");
  });

  test("returns the key itself when the message does not exist", () => {
    // in development a missing key is reported; the noise is not wanted here
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(t("chiave.che.non.esiste")).toBe("chiave.che.non.esiste");
    warn.mockRestore();
  });

  test("switches locale and switches back", () => {
    expect(getLocale()).toBe("it");
    expect(t("topbar.new")).toBe("Nuovo");

    setLocale("en");
    expect(getLocale()).toBe("en");
    expect(t("topbar.new")).toBe("New");

    setLocale("it");
    expect(t("topbar.new")).toBe("Nuovo");
  });

  test("an unknown locale is ignored", () => {
    // a code no plugin would register: "de" is a real language and another test
    // adds it, which would make this one depend on the order they run in
    setLocale("zz");
    expect(getLocale()).toBe("it");
  });
});

describe("falling back to Italian", () => {
  test("a key missing from the active locale falls back to Italian", () => {
    addMessages("it", { "test.soloItaliano": "Solo in italiano {n}" });
    setLocale("en");

    expect(t("test.soloItaliano", { n: 3 })).toBe("Solo in italiano 3");
    // mentre le chiavi tradotte restano in inglese
    expect(t("topbar.save")).toBe("Save");

    setLocale("it");
    expect(t("test.soloItaliano", { n: 3 })).toBe("Solo in italiano 3");
  });

  test("addMessages overwrites an existing message in the given locale", () => {
    addMessages("en", { "test.pluginKey": "From plugin" });
    addMessages("it", { "test.pluginKey": "Dal plugin" });

    expect(t("test.pluginKey")).toBe("Dal plugin");
    setLocale("en");
    expect(t("test.pluginKey")).toBe("From plugin");
    setLocale("it");
  });
});

describe("languages added at runtime", () => {
  test("a registered locale joins the list and can be selected", () => {
    expect(locales()).not.toContain("de");

    registerLocale("de", "Deutsch", { "topbar.save": "Speichern" });

    expect(locales()).toContain("de");
    setLocale("de");
    expect(getLocale()).toBe("de");
    expect(t("topbar.save")).toBe("Speichern");
    setLocale("it");
  });

  test("what the new locale does not translate falls back to Italian", () => {
    registerLocale("nb", "Norsk", { "topbar.save": "Lagre" });
    setLocale("nb");

    expect(t("topbar.save")).toBe("Lagre");
    // untranslated: the information has to survive, in some language
    expect(t("topbar.open")).toBe(it["topbar.open"]);
    setLocale("it");
  });

  test("registering the same locale again adds to it instead of replacing it", () => {
    registerLocale("sv", "Svenska", { "topbar.save": "Spara" });
    registerLocale("sv", "Svenska", { "topbar.open": "Öppna…" });
    setLocale("sv");

    expect(t("topbar.save")).toBe("Spara");
    expect(t("topbar.open")).toBe("Öppna…");
    setLocale("it");
  });

  test("missingKeys reports what a partial language still owes", () => {
    registerLocale("da", "Dansk", { "topbar.save": "Gem" });
    const missing = missingKeys("da");

    expect(missing).not.toContain("topbar.save");
    expect(missing.length).toBeGreaterThan(300);
  });
});
