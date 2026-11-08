/** Dates and numbers for people, always in Tashkent time and in the UI language. */
export const TIME_ZONE = "Asia/Tashkent";

const LOCALES: Record<string, string> = { uz: "uz-Latn-UZ", ru: "ru-RU", en: "en-GB" };
export const locale = (language: string) => LOCALES[language] ?? "en-GB";

export function formatDateTime(iso: string, language: string): string {
  return new Intl.DateTimeFormat(locale(language), {
    timeZone: TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function formatDate(iso: string, language: string): string {
  return new Intl.DateTimeFormat(locale(language), {
    timeZone: TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

/** "5 min ago" / "2 h ago" / a date — for "last seen" and lists. */
export function formatRelative(iso: string, language: string, now: Date = new Date()): string {
  const seconds = Math.round((new Date(iso).getTime() - now.getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale(language), { numeric: "auto" });
  const abs = Math.abs(seconds);
  if (abs < 60) return rtf.format(seconds, "second");
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), "hour");
  return formatDate(iso, language);
}

/** Age from birth year (the backend stores the year only). */
export function ageFromBirthYear(birthYear: number, now: Date = new Date()): number {
  return now.getFullYear() - birthYear;
}

/** 70.5 → "70.5" (en) / "70,5" (ru, uz). Height/weight: at most one decimal. */
export function formatNumber(value: number, language: string): string {
  return new Intl.NumberFormat(locale(language), { maximumFractionDigits: 1 }).format(value);
}
