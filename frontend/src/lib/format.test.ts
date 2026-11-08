import { formatDate, formatDateTime, formatNumber, formatRelative } from "./format";

// 09:05 UTC = 14:05 in Tashkent (UTC+5). These results must not depend on the runtime's Uzbek locale data.
const iso = "2026-11-08T09:05:00Z";
const now = new Date("2026-11-08T11:05:00Z");

test("dates in Tashkent time, in each language", () => {
  expect(formatDate(iso, "uz")).toBe("8-noyabr 2026");
  expect(formatDateTime(iso, "uz")).toBe("8-noyabr 2026, 14:05");
  expect(formatDateTime(iso, "en")).toBe("8 Nov 2026, 14:05");
  expect(formatDateTime(iso, "ru")).toMatch(/^8 нояб\. 2026 г\.,? 14:05$/);
  expect(formatDate("2026-12-31T20:00:00Z", "uz")).toBe("1-yanvar 2027"); // already next day in Tashkent
});

test("relative times read naturally in Uzbek", () => {
  expect(formatRelative(iso, "uz", now)).toBe("2 soat oldin");
  expect(formatRelative("2026-11-08T10:40:00Z", "uz", now)).toBe("25 daqiqa oldin");
  expect(formatRelative("2026-11-08T11:04:57Z", "uz", now)).toBe("hozirgina");
  expect(formatRelative(iso, "en", now)).toBe("2 hours ago");
  expect(formatRelative(iso, "ru", now)).toBe("2 часа назад");
  expect(formatRelative("2026-11-01T09:05:00Z", "uz", now)).toBe("1-noyabr 2026");
});

test("decimal comma in Uzbek and Russian", () => {
  expect(formatNumber(6.6, "uz")).toBe("6,6");
  expect(formatNumber(1250.5, "uz")).toBe("1 250,5");
  expect(formatNumber(6.6, "ru")).toBe("6,6");
  expect(formatNumber(6.6, "en")).toBe("6.6");
});
