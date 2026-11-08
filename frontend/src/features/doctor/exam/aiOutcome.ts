/**
 * What the AI said, as one of the outcomes the doctor's screen can show.
 * Mirrors backend `services/analyzer.py` (`ANSWER_LABELS`, `gave_answer`): keep the two in sync.
 *   label "murmur" / "absent" with quality not "bad" → an answer (the doctor says whether they agree)
 *   quality "bad"                                   → recording too poor to judge (no answer)
 *   label "not_analyzed" or no AI row               → no model connected (no answer)
 *   any other label                                 → shown as-is, honestly (no answer)
 */
import type { AIResult } from "../../../api/doctor";

export type AiOutcome =
  | { kind: "murmur" | "clear"; confidence: number | null; model: string }
  | { kind: "poorQuality"; model: string }
  | { kind: "unavailable"; model: string | null }
  | { kind: "other"; label: string; model: string };

export function aiOutcome(ai: AIResult | null): AiOutcome {
  if (!ai) return { kind: "unavailable", model: null };
  const model = `${ai.model_name} ${ai.model_version}`;
  if (ai.quality === "bad") return { kind: "poorQuality", model };
  if (ai.label === "murmur") return { kind: "murmur", confidence: ai.score, model };
  if (ai.label === "absent") return { kind: "clear", confidence: ai.score, model };
  if (ai.label === "not_analyzed") return { kind: "unavailable", model };
  return { kind: "other", label: ai.label, model };
}

/** Only an answer can be agreed or disagreed with (backend rejects agree/disagree otherwise). */
export function aiAnswered(outcome: AiOutcome): boolean {
  return outcome.kind === "murmur" || outcome.kind === "clear";
}
