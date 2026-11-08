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
const placeholders = (text: string) => (text.match(/{{\s*\w+\s*}}/g) ?? []).sort().join(",");

describe("translations", () => {
  test("every language has exactly the same keys", () => {
    const keys = Object.keys(locales.en).sort();
    expect(Object.keys(locales.uz).sort()).toEqual(keys);
    expect(Object.keys(locales.ru).sort()).toEqual(keys);
  });

  test("no empty text and the same {{placeholders}} in every language", () => {
    for (const [key, english] of Object.entries(locales.en)) {
      for (const lang of ["uz", "ru"] as const) {
        expect(locales[lang][key].trim(), `${lang}:${key}`).not.toBe("");
        expect(placeholders(locales[lang][key]), `${lang}:${key}`).toBe(placeholders(english));
      }
    }
  });

  test("Uzbek uses the proper oʻ / gʻ letter (U+02BB), never an apostrophe or a quote", () => {
    for (const [key, text] of Object.entries(locales.uz)) {
      expect(text, key).not.toMatch(/[oOgG]['‘’`´]/);
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
