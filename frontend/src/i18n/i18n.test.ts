import { detectLanguage } from "./detect";
import en from "./locales/en.json";
import ru from "./locales/ru.json";
import uz from "./locales/uz.json";

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Record<string, string> {
  return Object.entries(tree).reduce<Record<string, string>>((all, [key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string" ? { ...all, [path]: value } : { ...all, ...flatten(value, path) };
  }, {});
}

const locales = { uz: flatten(uz), ru: flatten(ru), en: flatten(en) };
const placeholders = (text: string) => [...new Set(text.match(/{{\s*\w+\s*}}/g) ?? [])].sort().join(",");
const PLURAL = /_(zero|one|two|few|many|other)$/;
const baseKeys = (lang: keyof typeof locales) => [...new Set(Object.keys(locales[lang]).map((k) => k.replace(PLURAL, "")))].sort();
/** The text a base key has in a language: the plain key, or its "_other" plural form. */
const textFor = (lang: keyof typeof locales, base: string) => locales[lang][base] ?? locales[lang][`${base}_other`];

describe("translations", () => {
  test("every language has the same keys (plural forms aside)", () => {
    expect(baseKeys("uz")).toEqual(baseKeys("en"));
    expect(baseKeys("ru")).toEqual(baseKeys("en"));
  });

  test("every plural key has exactly the forms its language needs (ru: one/few/many/other)", () => {
    for (const lang of ["uz", "ru", "en"] as const) {
      const needed = new Intl.PluralRules(lang).resolvedOptions().pluralCategories.sort();
      const plural = new Set(Object.keys(locales[lang]).filter((k) => PLURAL.test(k)).map((k) => k.replace(PLURAL, "")));
      for (const base of plural) {
        const forms = Object.keys(locales[lang]).filter((k) => k.replace(PLURAL, "") === base && PLURAL.test(k));
        expect(forms.map((k) => k.match(PLURAL)![1]).sort(), `${lang}:${base}`).toEqual(needed);
      }
    }
  });

  test("no empty text and the same {{placeholders}} in every language", () => {
    for (const lang of ["uz", "ru", "en"] as const) {
      for (const [key, text] of Object.entries(locales[lang])) expect(text.trim(), `${lang}:${key}`).not.toBe("");
    }
    for (const base of baseKeys("en")) {
      for (const lang of ["uz", "ru"] as const) {
        expect(placeholders(textFor(lang, base)), `${lang}:${base}`).toBe(placeholders(textFor("en", base)));
      }
    }
  });

  test("Uzbek uses the proper oʻ / gʻ letter (U+02BB), never an apostrophe or a quote", () => {
    for (const [key, text] of Object.entries(locales.uz)) {
      expect(text, key).not.toMatch(/[oOgG]['‘’`´]/);
    }
  });
});

describe("script and spelling", () => {
  test("Uzbek: Latin script only, tutuq belgisi (ʼ U+02BC) instead of any apostrophe", () => {
    for (const [key, text] of Object.entries(locales.uz)) {
      if (key.startsWith("language.")) continue; // language names are written in their own script ("Русский")
      expect(text, key).not.toMatch(/[Ѐ-ӿ]/); // no Cyrillic letters
      expect(text, key).not.toMatch(/['’‘`´]/); // maʼlumot, eʼlon: U+02BC
    }
  });

  test("Russian: no Latin look-alike letters inside Cyrillic words", () => {
    for (const [key, text] of Object.entries(locales.ru)) {
      expect(text, key).not.toMatch(/[а-яё][a-z]|[a-z][а-яё]/i);
    }
  });

  test("nothing left untranslated (same text as English), except a reviewed list", () => {
    // Checked by hand (2026-11-08): names, units and words that are the same in that language.
    const reviewed = new Set([
      "uz:app.name", "ru:app.name", "uz:roles.admin", "uz:patientForm.fullNamePlaceholder",
      "uz:devices.wifi", "ru:devices.wifi", "uz:devices.model", "uz:devices.signalLabel", "uz:registry.normal", "uz:registry.chip.normal", "uz:shell.rights", "ru:shell.rights",
    ]);
    for (const lang of ["uz", "ru"] as const) {
      for (const [key, text] of Object.entries(locales[lang])) {
        if (key.startsWith("language.") || reviewed.has(`${lang}:${key}`)) continue; // own names, same everywhere
        const words = text.replace(/{{\s*\w+\s*}}/g, ""); // a unit after a number ("{{value}} kg") is not a word
        if (locales.en[key] === text && /[a-z]{3}/i.test(words)) expect.fail(`${lang}:${key} is still English: ${text}`);
      }
    }
  });
});

describe("language detection", () => {
  test("the user's own choice wins", () => {
    expect(detectLanguage("ru", ["en-US", "uz"])).toBe("ru");
  });

  test("first supported browser language, by base tag", () => {
    expect(detectLanguage(null, ["de-DE", "ru-RU", "en"])).toBe("ru");
    expect(detectLanguage(null, ["uz-Cyrl-UZ"])).toBe("uz");
    expect(detectLanguage(null, ["EN-gb"])).toBe("en");
  });

  test("falls back to Uzbek; ignores a stored value we do not support", () => {
    expect(detectLanguage(null, ["de", "fr"])).toBe("uz");
    expect(detectLanguage("kk", [])).toBe("uz");
  });
});
