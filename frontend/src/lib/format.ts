/**
 * Dates, times and numbers for people — always Tashkent time, in the UI language.
 *
 * Uzbek is formatted by hand: many browsers ship without Uzbek locale data (found in task 4: Chromium printed
 * "2026 M11 8", "6.6" and "-2 h"). Russian and English use Intl, which every browser has.
 */
export const TIME_ZONE = "Asia/Tashkent";

const LOCALES: Record<string, string> = { ru: "ru-RU", en: "en-GB" };
export const locale = (language: string) => LOCALES[language] ?? "en-GB";

const UZ_MONTHS = [
  "yanvar",
  "fevral",
  "mart",
  "aprel",
  "may",
  "iyun",
  "iyul",
  "avgust",
  "sentabr",
  "oktabr",
  "noyabr",
  "dekabr",
];

/** Year/month/day/hour/minute in Tashkent, read through en-GB (locale data every browser has). */
function tashkentParts(iso: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { year: get("year"), month: Number(get("month")), day: Number(get("day")), time: `${get("hour")}:${get("minute")}` };
}

/** "8-noyabr 2026" · "8 нояб. 2026 г." · "8 Nov 2026" */
export function formatDate(iso: string, language: string): string {
  if (language === "uz") {
    const p = tashkentParts(iso);
    return `${p.day}-${UZ_MONTHS[p.month - 1]} ${p.year}`;
  }
  return new Intl.DateTimeFormat(locale(language), {
    timeZone: TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

/** "8-noyabr 2026, 14:05" · "8 нояб. 2026 г., 14:05" · "8 Nov 2026, 14:05" */
export function formatDateTime(iso: string, language: string): string {
  if (language === "uz") return `${formatDate(iso, "uz")}, ${tashkentParts(iso).time}`;
  return new Intl.DateTimeFormat(locale(language), {
    timeZone: TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** "2 soat oldin" · "2 часа назад" · "2 hours ago"; older than a day → the date. */
export function formatRelative(iso: string, language: string, now: Date = new Date()): string {
  const seconds = Math.round((new Date(iso).getTime() - now.getTime()) / 1000);
  const abs = Math.abs(seconds);
  if (abs >= 86400) return formatDate(iso, language);
  const [value, unit] =
    abs < 60
      ? [Math.round(seconds), "second" as const]
      : abs < 3600
        ? [Math.round(seconds / 60), "minute" as const]
        : [Math.round(seconds / 3600), "hour" as const];
  if (language === "uz") {
    if (abs < 10) return "hozirgina";
    const word = { second: "soniya", minute: "daqiqa", hour: "soat" }[unit];
    return value < 0 ? `${-value} ${word} oldin` : `${value} ${word}dan keyin`;
  }
  return new Intl.RelativeTimeFormat(locale(language), { numeric: "auto" }).format(value, unit);
}

/** Age from birth year (the backend stores the year only). */
export function ageFromBirthYear(birthYear: number, now: Date = new Date()): number {
  return now.getFullYear() - birthYear;
}

/** 70.5 → "70.5" (en) / "70,5" (ru, uz). At most one decimal; Uzbek groups thousands with a narrow space. */
export function formatNumber(value: number, language: string): string {
  if (language === "uz") {
    return new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 })
      .format(value)
      .replace(/,/g, " ")
      .replace(".", ",");
  }
  return new Intl.NumberFormat(locale(language), { maximumFractionDigits: 1 }).format(value);
}
