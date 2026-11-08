import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import { detectLanguage, type Language, readStoredLanguage, storeLanguage } from "./detect";
import en from "./locales/en.json";
import ru from "./locales/ru.json";
import uz from "./locales/uz.json";

export const resources = { uz: { translation: uz }, ru: { translation: ru }, en: { translation: en } } as const;

const initial = detectLanguage(readStoredLanguage(), typeof navigator === "undefined" ? [] : navigator.languages);

void i18n.use(initReactI18next).init({
  resources,
  lng: initial,
  fallbackLng: "en",
  interpolation: { escapeValue: false }, // React already escapes
  returnNull: false,
});
document.documentElement.lang = initial;

/** Switch language for this browser and remember it. */
export function changeLanguage(language: Language): void {
  storeLanguage(language);
  document.documentElement.lang = language;
  void i18n.changeLanguage(language);
}

export default i18n;
