export const LANGUAGES = ["uz", "ru", "en"] as const;
export type Language = (typeof LANGUAGES)[number];

export const STORAGE_KEY = "murmur.lang";
export const FALLBACK: Language = "uz";

function isLanguage(value: string | null | undefined): value is Language {
  return !!value && (LANGUAGES as readonly string[]).includes(value);
}

/**
 * Owner decision (2026-11-08): the user's own pick wins; otherwise the first of uz/ru/en found in the browser's
 * language list ("uz-Cyrl-UZ" → uz, "ru-RU" → ru); otherwise Uzbek.
 */
export function detectLanguage(stored: string | null, browserLanguages: readonly string[]): Language {
  if (isLanguage(stored)) return stored;
  for (const tag of browserLanguages) {
    const base = tag.toLowerCase().split("-")[0];
    if (isLanguage(base)) return base;
  }
  return FALLBACK;
}

export function readStoredLanguage(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // private mode or blocked storage: detection still works
  }
}

export function storeLanguage(language: Language): void {
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // not fatal: the choice just will not survive a reload
  }
}
