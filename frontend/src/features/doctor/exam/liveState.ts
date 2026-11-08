/**
 * The live exam as a state machine the screen can draw — pure functions, unit-tested.
 * Backend flow (services/exam_flow.py): waiting → recording → uploaded → analyzed → reviewed, or failed.
 */
import type { ExamDetail, ExamStatus } from "../../../api/doctor";

export const RECORD_SECONDS = 20; // backend RECORD_SECONDS; the device records this long
export const WAITING_TOO_LONG_S = 15; // device polls every 1–2 s: 15 s without pickup = something is wrong
export const UPLOAD_GRACE_S = 30; // after the 20 s recording, upload + WAV should arrive well within this

/** How often to ask the server, by status: fast while things move, never once the exam is final. */
export function pollInterval(status: ExamStatus | undefined): number | false {
  if (status === "waiting" || status === "recording") return 1000;
  if (status === "uploaded") return 1500;
  if (status === undefined) return 1000;
  return false; // analyzed, reviewed, failed: nothing will change by itself
}

export type Stage = "command" | "recording" | "checking" | "result";
export const STAGES: Stage[] = ["command", "recording", "checking", "result"];

export type LiveState =
  | { kind: "waiting"; stage: "command"; stuck: boolean }
  | { kind: "recording"; stage: "recording"; elapsed: number; remaining: number; overdue: boolean }
  | { kind: "checking"; stage: "checking" }
  | { kind: "ready"; stage: "result" }
  | { kind: "reviewed"; stage: "result" }
  | { kind: "failed"; stage: "recording" | "checking"; reasons: FailureReason[] };

/**
 * @param recordingSeenAt when recording started (ms): the exam's `updated_at`, which the server sets when the device
 *   takes the command — so a reload mid-recording keeps the right countdown.
 */
export function liveState(exam: ExamDetail, now: number, recordingSeenAt: number | null): LiveState {
  switch (exam.status) {
    case "waiting":
      return { kind: "waiting", stage: "command", stuck: (now - Date.parse(exam.created_at)) / 1000 > WAITING_TOO_LONG_S };
    case "recording": {
      const elapsed = recordingSeenAt === null ? 0 : Math.max(0, (now - recordingSeenAt) / 1000);
      return {
        kind: "recording",
        stage: "recording",
        elapsed,
        remaining: Math.max(0, Math.ceil(RECORD_SECONDS - elapsed)),
        overdue: elapsed > RECORD_SECONDS + UPLOAD_GRACE_S,
      };
    }
    case "uploaded":
      return { kind: "checking", stage: "checking" };
    case "analyzed":
      return { kind: "ready", stage: "result" };
    case "reviewed":
      return { kind: "reviewed", stage: "result" };
    case "failed":
      // Mark the step where it really stopped: a recording arrived → it failed at quality/AI; none → at recording.
      return {
        kind: "failed",
        stage: exam.recording ? "checking" : "recording",
        reasons: parseFailure(exam.failure_reason),
      };
  }
}

export type FailureReason = { key: string; values?: Record<string, string | number> };

/**
 * The backend writes failure reasons in English (services/quality.py, exam_flow.cancel, analysis.py).
 * They are mapped here, in one place, to i18n keys with their numbers — so the doctor reads them in their language.
 */
export function parseFailure(reason: string | null): FailureReason[] {
  if (!reason) return [{ key: "exam.failure.unknown" }];
  if (reason === "cancelled by doctor") return [{ key: "exam.failure.cancelled" }];
  if (reason.startsWith("re-record: ")) {
    return reason
      .slice("re-record: ".length)
      .split("; ")
      .map((part): FailureReason => {
        const short = part.match(/^too short \(([\d.]+) s, need at least (\d+) s\)$/);
        if (short) return { key: "exam.failure.tooShort", values: { seconds: Number(short[1]), minimum: Number(short[2]) } };
        if (part.startsWith("almost silent")) return { key: "exam.failure.silent" };
        const loud = part.match(/^too loud, (\d+)% of the sound is clipped$/);
        if (loud) return { key: "exam.failure.clipped", values: { percent: Number(loud[1]) } };
        if (part.startsWith("movement detected")) return { key: "exam.failure.motion" };
        return { key: "exam.failure.quality" };
      });
  }
  if (/^(analysis error|could not store analysis result|quality check error)/.test(reason)) {
    return [{ key: "exam.failure.analysis" }];
  }
  return [{ key: "exam.failure.unknown" }];
}
