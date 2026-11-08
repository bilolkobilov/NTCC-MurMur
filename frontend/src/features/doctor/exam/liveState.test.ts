import type { ExamDetail } from "../../../api/doctor";
import { liveState, parseFailure, pollInterval } from "./liveState";

const base: ExamDetail = {
  id: 1,
  patient_id: 1,
  device_id: 1,
  point: "MV",
  status: "waiting",
  created_at: "2026-11-08T10:00:00Z",
  reviewed_at: null,
  failure_reason: null,
  doctor_note: null,
  doctor_agrees_with_ai: null,
  updated_at: "2026-11-08T10:00:00Z",
  recording: null,
  ai_result: null,
};
const t0 = Date.parse(base.created_at);

test("poll fast while the device works, stop when the exam is final", () => {
  expect(pollInterval("waiting")).toBe(1000);
  expect(pollInterval("recording")).toBe(1000);
  expect(pollInterval("uploaded")).toBe(1500);
  for (const status of ["analyzed", "reviewed", "failed"] as const) expect(pollInterval(status)).toBe(false);
});

test("waiting becomes 'stuck' after 15 s without the device taking the command", () => {
  expect(liveState(base, t0 + 14_000, null)).toEqual({ kind: "waiting", stage: "command", stuck: false });
  expect(liveState(base, t0 + 16_000, null)).toMatchObject({ kind: "waiting", stuck: true });
});

test("recording counts down from 20 s and is overdue only well after the end", () => {
  const exam = { ...base, status: "recording" as const };
  expect(liveState(exam, t0 + 5_500, t0)).toMatchObject({ remaining: 15, overdue: false });
  expect(liveState(exam, t0 + 25_000, t0)).toMatchObject({ remaining: 0, overdue: false });
  expect(liveState(exam, t0 + 51_000, t0)).toMatchObject({ remaining: 0, overdue: true });
  expect(liveState(exam, t0 + 99_000, null)).toMatchObject({ remaining: 20, elapsed: 0 });
});

test("failure reasons become i18n keys with their numbers", () => {
  expect(parseFailure("cancelled by doctor")).toEqual([{ key: "exam.failure.cancelled" }]);
  expect(parseFailure("re-record: too short (6.6 s, need at least 10 s)")).toEqual([
    { key: "exam.failure.tooShort", values: { seconds: 6.6, minimum: 10 } },
  ]);
  expect(
    parseFailure(
      "re-record: too short (5.0 s, need at least 10 s); almost silent (is the stethoscope touching the chest?); " +
        "too loud, 4% of the sound is clipped; movement detected during recording",
    ).map((r) => r.key),
  ).toEqual(["exam.failure.tooShort", "exam.failure.silent", "exam.failure.clipped", "exam.failure.motion"]);
  expect(parseFailure("re-record: too loud, 4% of the sound is clipped")[0].values).toEqual({ percent: 4 });
  expect(parseFailure("analysis error: RuntimeError")).toEqual([{ key: "exam.failure.analysis" }]);
  expect(parseFailure("could not store analysis result: DataError")).toEqual([{ key: "exam.failure.analysis" }]);
  expect(parseFailure("re-record: something new")).toEqual([{ key: "exam.failure.quality" }]);
  expect(parseFailure("??")).toEqual([{ key: "exam.failure.unknown" }]);
  expect(parseFailure(null)).toEqual([{ key: "exam.failure.unknown" }]);
});

test("the parser matches what the backend really writes", async () => {
  // Same strings as backend/app/services/quality.py `problems()` and exam_flow.cancel — keep in sync.
  const backendStrings = [
    "re-record: too short (6.6 s, need at least 10 s)",
    "re-record: almost silent (is the stethoscope touching the chest?)",
    "re-record: too loud, 12% of the sound is clipped",
    "re-record: movement detected during recording",
    "cancelled by doctor",
  ];
  for (const text of backendStrings) {
    expect(parseFailure(text).every((r) => !["exam.failure.unknown", "exam.failure.quality"].includes(r.key))).toBe(true);
  }
});

test("a failed exam marks the step where it stopped, not 'all done'", () => {
  const cancelled = { ...base, status: "failed" as const, failure_reason: "cancelled by doctor" };
  expect(liveState(cancelled, t0, null).stage).toBe("recording");
  const rejected = {
    ...cancelled,
    failure_reason: "re-record: too short (6.6 s, need at least 10 s)",
    recording: { sample_rate: 4000, duration_s: 6.6, motion_detected: false, size_bytes: 1, created_at: base.created_at },
  };
  expect(liveState(rejected, t0, null).stage).toBe("checking");
});
