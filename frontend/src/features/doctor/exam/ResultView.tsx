import { useMutation, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useBlocker } from "react-router";

import { ApiError, errorMessage } from "../../../api/client";
import { doctorApi, type ExamDetail } from "../../../api/doctor";
import { Alert } from "../../../components/ui/Alert";
import { Button, ButtonLink } from "../../../components/ui/Button";
import { Dialog } from "../../../components/ui/Dialog";
import { formatDateTime, formatNumber } from "../../../lib/format";
import { aiAnswered, type AiOutcome, aiOutcome } from "./aiOutcome";
import { EcgCard } from "./EcgStrip";
import { HeartStrip } from "./HeartStrip";

const NOTE_MAX = 5000; // backend ExamReview.note max_length

/**
 * An analysed or reviewed exam: the recording is the spine, the ECG recorded with it right under it; the AI opinion
 * and the doctor's conclusion sit beside them.
 * Dense where read (AI card), generous where the decision is made (review form).
 */
export function ResultView({ exam }: { exam: ExamDetail }) {
  const outcome = aiOutcome(exam.ai_result);
  // Set when another tab (or a double submit) reviewed first: the saved conclusion is shown with an explanation.
  const [conflict, setConflict] = useState(false);
  return (
    <div className="mt-6 flex flex-col gap-6">
      <HeartStrip examId={exam.id} />
      <EcgCard examId={exam.id} hasEcg={exam.has_ecg} result={exam.ecg_result} />
      <div className="grid items-start gap-6 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <AiCard outcome={outcome} patientId={exam.patient_id} />
        {exam.status === "reviewed" ? (
          <Conclusion exam={exam} conflict={conflict} />
        ) : (
          <ReviewForm exam={exam} answered={aiAnswered(outcome)} onConflict={() => setConflict(true)} />
        )}
      </div>
    </div>
  );
}

function AiCard({ outcome, patientId }: { outcome: AiOutcome; patientId: number }) {
  const { t, i18n } = useTranslation();
  const tone =
    outcome.kind === "murmur" ? "text-finding" : outcome.kind === "clear" ? "text-clear" : "text-ink-900";
  return (
    <section aria-labelledby="ai-title" className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="ai-title" className="text-label font-semibold tracking-wide whitespace-nowrap text-ink-500 uppercase">
          {t("result.aiTitle")}
        </h2>
        {outcome.model && (
          <span translate="no" className="font-mono text-caption text-ink-500">
            {outcome.model}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <p className={clsx("flex items-center gap-2 text-title font-semibold", tone)}>
          <OutcomeMark kind={outcome.kind} />
          {t(`result.outcome.${outcome.kind}`, outcome.kind === "other" ? { label: outcome.label } : {})}
        </p>
        {(outcome.kind === "murmur" || outcome.kind === "clear") && outcome.murmurProbability !== null && (
          <p className="font-mono text-label text-ink-700 tabular-nums">
            {t("result.confidence", { percent: formatNumber(Math.round(outcome.murmurProbability * 100), i18n.language) })}
          </p>
        )}
        <p className="text-ink-700">{t(`result.outcomeBody.${outcome.kind}`)}</p>
      </div>

      {outcome.kind === "poorQuality" && (
        <ButtonLink to={`/doctor/patients/${patientId}/exam`} className="self-start">
          {t("live.recordAgain")}
        </ButtonLink>
      )}

      <p className="border-t border-line pt-3 text-caption text-ink-500">{t("result.disclaimer")}</p>
    </section>
  );
}

/** A small mark next to the outcome, so colour is never the only signal. */
function OutcomeMark({ kind }: { kind: AiOutcome["kind"] }) {
  const common = "size-5 shrink-0";
  if (kind === "murmur") {
    // the trace with an extra bump between the beats
    return (
      <svg viewBox="0 0 20 20" className={common} aria-hidden="true">
        <path d="M1 10h4l1.5-5 2 10 1.5-5h1.5c.7-2 1.8-2 2.5 0h5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === "clear") {
    return (
      <svg viewBox="0 0 20 20" className={common} aria-hidden="true">
        <path d="M1 10h4l1.5-5 2 10 1.5-5H19" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" className={common} aria-hidden="true">
      <path d="M2 10h16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="2.5 2.5" />
    </svg>
  );
}

function ReviewForm({ exam, answered, onConflict }: { exam: ExamDetail; answered: boolean; onConflict: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [agrees, setAgrees] = useState<boolean | null>(null);
  const [problems, setProblems] = useState<{ agrees?: string; note?: string }>({});
  const agreeRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  const save = useMutation({
    mutationFn: () => doctorApi.reviewExam(exam.id, note.trim(), answered ? agrees : null),
    onSuccess: (reviewed) => {
      queryClient.setQueryData(["exam", exam.id], reviewed);
      void queryClient.invalidateQueries({ queryKey: ["exams"] });
      void queryClient.invalidateQueries({ queryKey: ["patientExams", exam.patient_id] });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        onConflict();
        void queryClient.invalidateQueries({ queryKey: ["exam", exam.id] }); // show what was saved
      }
    },
  });

  const dirty = note.trim() !== "" || agrees !== null;
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && !save.isPending && !save.isSuccess && currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (!dirty || save.isSuccess) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, save.isSuccess]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found: typeof problems = {};
    if (answered && agrees === null) found.agrees = t("review.agreeRequired");
    if (note.trim() === "") found.note = t("review.noteRequired");
    setProblems(found);
    if (found.agrees) agreeRef.current?.focus();
    else if (found.note) noteRef.current?.focus();
    else save.mutate();
  };

  const conflictError = save.error instanceof ApiError && save.error.status === 409;
  return (
    <section aria-labelledby="review-title" className="rounded-card border border-line bg-surface p-4 sm:p-6">
      <h2 id="review-title" className="text-title font-semibold">
        {t("review.title")}
      </h2>
      <form noValidate onSubmit={submit} className="mt-4 flex flex-col gap-5">
        {answered && (
          <fieldset aria-describedby={problems.agrees ? "agree-error" : undefined}>
            <legend className="text-label font-medium text-ink-700 after:ml-1 after:text-ink-300 after:content-['*']">
              {t("review.agreeQuestion")}
            </legend>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {([true, false] as const).map((value) => (
                <label
                  key={String(value)}
                  className={clsx(
                    "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-control border px-3 py-2",
                    "transition-[background-color,border-color] duration-150",
                    "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink-900",
                    agrees === value ? "border-ink-900 bg-canvas" : "border-line-strong hover:border-ink-300",
                  )}
                >
                  <input
                    ref={value ? agreeRef : undefined}
                    type="radio"
                    name="agrees"
                    checked={agrees === value}
                    onChange={() => setAgrees(value)}
                    className="size-4 accent-ink-900"
                  />
                  <span className="font-medium">{value ? t("review.agree") : t("review.disagree")}</span>
                </label>
              ))}
            </div>
            {problems.agrees && (
              <p id="agree-error" className="mt-1.5 text-caption font-medium text-danger">
                {problems.agrees}
              </p>
            )}
          </fieldset>
        )}

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="review-note"
            className="text-label font-medium text-ink-700 after:ml-1 after:text-ink-300 after:content-['*']"
          >
            {t("review.note")}
          </label>
          <textarea
            id="review-note"
            ref={noteRef}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={NOTE_MAX}
            rows={5}
            required
            aria-invalid={problems.note ? true : undefined}
            aria-describedby={problems.note ? "note-error" : "note-hint"}
            className={clsx(
              "min-h-32 resize-y rounded-control border bg-field px-3 py-2.5 text-body text-ink-900 placeholder:text-ink-300",
              "transition-[background-color,border-color] duration-150",
              "focus:border-ink-900 focus:bg-surface focus:outline-2 focus:outline-offset-1 focus:outline-ink-900/15",
              problems.note ? "border-danger" : "border-line-strong hover:border-ink-300",
            )}
          />
          {problems.note ? (
            <p id="note-error" className="text-caption font-medium text-danger">
              {problems.note}
            </p>
          ) : (
            <p id="note-hint" className="flex justify-between gap-3 text-caption text-ink-500">
              <span>{t("review.noteHint")}</span>
              {note.length > NOTE_MAX - 500 && (
                <span className="font-mono tabular-nums">
                  {note.length} / {NOTE_MAX}
                </span>
              )}
            </p>
          )}
        </div>

        {save.isError && !conflictError && <Alert tone="danger">{t(errorMessage(save.error).key)}</Alert>}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" busy={save.isPending} busyText={t("review.saving")}>
            {t("review.confirm")}
          </Button>
          <p className="text-caption text-ink-500">{t("review.final")}</p>
        </div>
      </form>

      <Dialog
        open={blocker.state === "blocked"}
        onOpenChange={(open) => !open && blocker.reset?.()}
        title={t("review.leaveTitle")}
        description={t("review.leaveBody")}
        footer={
          <>
            <Button onClick={() => blocker.reset?.()}>{t("patientForm.keepEditing")}</Button>
            <Button variant="danger" onClick={() => blocker.proceed?.()}>
              {t("patientForm.leave")}
            </Button>
          </>
        }
      />
    </section>
  );
}

function Conclusion({ exam, conflict }: { exam: ExamDetail; conflict: boolean }) {
  const { t, i18n } = useTranslation();
  return (
    <section aria-labelledby="conclusion-title" className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4 sm:p-6">
      {conflict && <Alert>{t("review.alreadyReviewed")}</Alert>}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="conclusion-title" className="text-title font-semibold">
          {t("review.conclusionTitle")}
        </h2>
        {exam.reviewed_at && (
          <span className="text-label text-ink-500 tabular-nums">{formatDateTime(exam.reviewed_at, i18n.language)}</span>
        )}
      </div>
      {exam.doctor_agrees_with_ai !== null && (
        <p className="chip-quiet self-start">
          {exam.doctor_agrees_with_ai ? t("review.youAgreed") : t("review.youDisagreed")}
        </p>
      )}
      <p className="text-body whitespace-pre-wrap text-ink-900 [overflow-wrap:anywhere]">{exam.doctor_note}</p>
      <p className="border-t border-line pt-3 text-caption text-clear">{t("review.patientSees")}</p>
    </section>
  );
}
