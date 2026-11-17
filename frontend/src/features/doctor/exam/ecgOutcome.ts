/**
 * What the server measured in the ECG, as one of the states the doctor's ECG card can show.
 * Mirrors backend `services/ecg.py` (problem codes) and `services/ai/ecg_rhythm.py` (rhythm labels): keep in sync.
 *   quality "good" → heart rate, beat-to-beat spread, and the rhythm model's answer when one ran
 *   quality "bad"  → "cannot judge" with the reason; never numbers
 */
import type { EcgResult } from "../../../api/doctor";

export const ECG_PROBLEMS = ["lead_off", "saturated", "flat", "no_beats", "noisy", "invalid", "error"] as const;
export const RHYTHM_LABELS = ["af_suspected", "no_af", "unclear"] as const;

export type EcgProblem = (typeof ECG_PROBLEMS)[number] | "unknown";
export type Rhythm = { label: (typeof RHYTHM_LABELS)[number]; pAf: number | null; model: string } | null;

export type EcgOutcome =
  | { kind: "measured"; heartRate: number; spread: number | null; beats: number; rhythm: Rhythm }
  | { kind: "cannotJudge"; problem: EcgProblem }
  | { kind: "pending" };

export function ecgOutcome(result: EcgResult | null): EcgOutcome {
  if (!result) return { kind: "pending" };
  if (result.quality !== "good" || result.heart_rate === null) {
    const problem = ECG_PROBLEMS.find((p) => p === result.problem) ?? "unknown";
    return { kind: "cannotJudge", problem };
  }
  const label = RHYTHM_LABELS.find((l) => l === result.rhythm_label);
  const rhythm: Rhythm = label
    ? { label, pAf: result.rhythm_p_af, model: `${result.rhythm_model_name ?? ""} ${result.rhythm_model_version ?? ""}`.trim() }
    : null;
  return { kind: "measured", heartRate: result.heart_rate, spread: result.rr_cv, beats: result.beats, rhythm };
}
