import { afterAll, describe, expect, test, vi } from "vitest";
import { LOCALES, addMessages, getLocale, missingKeys, setLocale, t } from "@/i18n";
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
    for (const locale of LOCALES) {
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
    setLocale("de" as never);
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
