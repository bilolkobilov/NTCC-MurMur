import { TIME_ZONE } from "../../lib/format";
import type { MyExam } from "../../api/patient";

/** A visit = the exams of one calendar day (Tashkent time): up to four positions, plus repeats. */
export type Visit = { key: string; date: string; exams: MyExam[] };

/** The order a doctor listens in. */
const ORDER = ["AV", "PV", "TV", "MV"];

const dayKey = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(new Date(iso)); // 2026-11-10

/** Newest visit first; inside a visit the exams follow the listening order. */
export function groupVisits(exams: MyExam[]): Visit[] {
  const byDay = new Map<string, Visit>();
  for (const exam of exams) {
    const key = dayKey(exam.created_at);
    const visit = byDay.get(key) ?? { key, date: exam.created_at, exams: [] };
    visit.exams.push(exam);
    byDay.set(key, visit);
  }
  for (const visit of byDay.values()) visit.exams.sort((a, b) => ORDER.indexOf(a.point) - ORDER.indexOf(b.point) || a.id - b.id);
  return [...byDay.values()].sort((a, b) => b.key.localeCompare(a.key));
}

export type VisitSummary = { murmur: number; answered: number; good: number; total: number };

export function summarize(exams: MyExam[]): VisitSummary {
  return {
    murmur: exams.filter((e) => e.ai_label === "murmur").length,
    answered: exams.filter((e) => e.ai_label !== null).length,
    good: exams.filter((e) => e.recording_quality === "good").length,
    total: exams.length,
  };
}
