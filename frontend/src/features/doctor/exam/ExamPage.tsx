import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";

import { errorMessage } from "../../../api/client";
import { type ExamDetail, doctorApi } from "../../../api/doctor";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { ErrorState, SkeletonRows } from "../../../components/ui/States";
import { formatDateTime, formatNumber } from "../../../lib/format";
import { PointLabel } from "../shared";
import { type LiveState, liveState, pollInterval, RECORD_SECONDS, type Stage, STAGES } from "./liveState";

/** Re-render every `ms` while `active` (countdowns, "stuck" timers). */
function useNow(active: boolean, ms = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(timer);
  }, [active, ms]);
  return now;
}

/**
 * When did recording start? The server sets `updated_at` at the moment the device takes the command, so it survives
 * a reload mid-recording. Server and browser share the laptop clock in the demo; a phone syncs its clock over the
 * network. (A badly wrong phone clock would only shift the countdown, never the exam itself.)
 */
function recordingStart(exam: ExamDetail): number | null {
  return exam.status === "recording" ? Date.parse(exam.updated_at) : null;
}

export function ExamPage() {
  const id = Number(useParams().examId);
  const { t, i18n } = useTranslation();
  const exam = useQuery({
    queryKey: ["exam", id],
    queryFn: () => doctorApi.getExam(id),
    refetchInterval: (query) => pollInterval(query.state.data?.status),
  });
  const patient = useQuery({
    queryKey: ["patient", exam.data?.patient_id],
    queryFn: () => doctorApi.getPatient(exam.data!.patient_id),
    enabled: !!exam.data,
  });
  const devices = useQuery({ queryKey: ["devices"], queryFn: doctorApi.myDevices });
  const moving = exam.data?.status === "waiting" || exam.data?.status === "recording";
  const now = useNow(moving);

  if (!exam.data) {
    if (exam.isError) return <ErrorState error={exam.error} onRetry={() => void exam.refetch()} />;
    return <SkeletonRows rows={4} label={t("common.loading")} />;
  }
  const e = exam.data;
  const state = liveState(e, now, recordingStart(e));
  const device = devices.data?.find((d) => d.id === e.device_id);

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        to={`/doctor/patients/${e.patient_id}`}
        className="mb-3 inline-flex min-h-11 items-center text-label text-ink-500 hover:text-ink-900"
      >
        ← {patient.data?.full_name ?? t("patients.title")}
      </Link>
      <div className="mb-6 flex flex-col gap-1">
        <h1 className="text-headline font-semibold">{patient.data?.full_name ?? "…"}</h1>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-500">
          <PointLabel point={e.point} />
          {device && <span>{device.name}</span>}
          <span className="tabular-nums">{formatDateTime(e.created_at, i18n.language)}</span>
        </p>
      </div>

      {exam.isError && (
        <div className="mb-4">
          <Alert>{t("live.reconnecting")}</Alert>
        </div>
      )}

      <section aria-labelledby="live-title" className="overflow-hidden rounded-card border border-line bg-surface">
        <StageTrack state={state} />
        <div aria-live="polite" className="p-6">
          <LiveBody exam={e} state={state} deviceName={device?.name} />
        </div>
      </section>
    </div>
  );
}

function StageTrack({ state }: { state: LiveState }) {
  const { t } = useTranslation();
  const current = STAGES.indexOf(state.stage);
  return (
    <ol aria-label={t("live.progress")} className="grid grid-cols-4 border-b border-line">
      {STAGES.map((stage: Stage, index) => {
        const failed = state.kind === "failed" && index === current;
        const done = index < current || (index === current && (state.kind === "ready" || state.kind === "reviewed"));
        const active = index === current && !done && !failed;
        return (
          <li
            key={stage}
            aria-current={active ? "step" : undefined}
            className={clsx(
              "flex min-h-14 flex-col justify-center gap-1 border-r border-line px-3 py-2 last:border-r-0 sm:px-4",
              active && "bg-canvas",
            )}
          >
            <span
              aria-hidden="true"
              className={clsx(
                "h-1 rounded-full",
                failed ? "bg-danger" : done ? "bg-ink-900" : active ? "bg-signal" : "bg-line",
              )}
            />
            <span
              className={clsx(
                "text-caption sm:text-label",
                failed ? "font-semibold text-danger" : active || done ? "font-semibold text-ink-900" : "text-ink-500",
              )}
            >
              <span className="sr-only">
                {failed ? t("live.stepFailed") : done ? t("live.stepDone") : active ? t("live.stepNow") : t("live.stepLater")}{" "}
              </span>
              {t(`live.stage.${stage}`)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function LiveBody({ exam, state, deviceName }: { exam: ExamDetail; state: LiveState; deviceName?: string }) {
  const { t } = useTranslation();
  switch (state.kind) {
    case "waiting":
      return (
        <div className="flex flex-col gap-4">
          <h2 id="live-title" className="text-title font-semibold">
            {state.stuck ? t("live.stuckTitle") : t("live.waitingTitle", { device: deviceName ?? "MurMur" })}
          </h2>
          <FlatStrip />
          {state.stuck ? (
            <>
              <ul className="list-disc pl-5 text-ink-700">
                <li>{t("live.stuckPower")}</li>
                <li>{t("live.stuckWifi")}</li>
                <li>{t("live.stuckServer")}</li>
              </ul>
              <CancelButton examId={exam.id} prominent />
            </>
          ) : (
            <div className="flex items-center justify-between gap-4">
              <p className="text-ink-500">{t("live.waitingBody")}</p>
              <CancelButton examId={exam.id} />
            </div>
          )}
        </div>
      );
    case "recording":
      return (
        <div className="flex flex-col gap-4">
          <div className="flex items-end justify-between gap-4">
            <h2 id="live-title" className="text-title font-semibold">
              {state.remaining > 0 ? t("live.recordingTitle") : t("live.uploadingTitle")}
            </h2>
            <p className="text-display font-semibold text-signal tabular-nums" aria-hidden="true">
              {state.remaining > 0 ? t("live.secondsLeft", { count: state.remaining }) : "…"}
            </p>
          </div>
          <SweepStrip elapsed={state.elapsed} />
          <p className="text-ink-700">{t("live.recordingBody")}</p>
          {state.overdue && (
            <div className="flex flex-col gap-3">
              <Alert tone="danger">{t("live.overdue")}</Alert>
              <CancelButton examId={exam.id} prominent />
            </div>
          )}
        </div>
      );
    case "checking":
      return (
        <div className="flex flex-col gap-3">
          <h2 id="live-title" className="text-title font-semibold">
            {t("live.checkingTitle")}
          </h2>
          <p className="text-ink-700">{t("live.checkingBody")}</p>
        </div>
      );
    case "ready":
    case "reviewed":
      return (
        <div className="flex flex-col gap-2">
          <h2 id="live-title" className="text-title font-semibold">
            {state.kind === "ready" ? t("live.readyTitle") : t("live.reviewedTitle")}
          </h2>
          <p className="text-ink-500">{t("live.resultViewNext")}</p>
        </div>
      );
    case "failed":
      return <FailedBody exam={exam} state={state} />;
  }
}

/** Waiting: a flat dotted line on chart paper — nothing recorded yet. */
function FlatStrip() {
  return (
    <div className="chart-grid relative h-24 overflow-hidden rounded-control border border-grid-major" aria-hidden="true">
      <span className="absolute inset-x-0 top-1/2 border-t-2 border-dashed border-ink-300" />
    </div>
  );
}

/**
 * Recording: the signature moment. A red line sweeps the chart paper in exactly 20 s, started at the real elapsed
 * time (negative delay), so reloading mid-recording does not restart it. Reduced motion: no sweep, countdown only.
 */
function SweepStrip({ elapsed }: { elapsed: number }) {
  return (
    <div className="chart-grid relative h-24 overflow-hidden rounded-control border border-grid-major" aria-hidden="true">
      <div
        className="absolute inset-y-0 left-0 w-full motion-reduce:hidden"
        style={{
          animation: `sweep ${RECORD_SECONDS}s linear forwards`,
          animationDelay: `-${Math.min(elapsed, RECORD_SECONDS)}s`,
        }}
      >
        <span className="absolute inset-y-0 right-full w-[200vw] bg-signal/5" />
        <span className="absolute inset-y-0 left-0 w-0.5 bg-signal" />
      </div>
    </div>
  );
}

function CancelButton({ examId, prominent = false }: { examId: number; prominent?: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const cancel = useMutation({
    mutationFn: () => doctorApi.cancelExam(examId),
    onSuccess: (exam) => queryClient.setQueryData(["exam", examId], exam),
    onError: () => void queryClient.invalidateQueries({ queryKey: ["exam", examId] }), // e.g. it moved on: show truth
  });
  return (
    <div className="flex flex-col items-start gap-2">
      {cancel.isError && <p className="text-caption text-danger">{t(errorMessage(cancel.error).key)}</p>}
      <Button
        variant={prominent ? "danger" : "ghost"}
        busy={cancel.isPending}
        busyText={t("live.cancelling")}
        onClick={() => cancel.mutate()}
      >
        {t("live.cancel")}
      </Button>
    </div>
  );
}

function FailedBody({ exam, state }: { exam: ExamDetail; state: Extract<LiveState, { kind: "failed" }> }) {
  const { t, i18n } = useTranslation();
  // Numbers inside reasons follow the language too ("6,6 s" in Uzbek and Russian).
  const localized = (values: Record<string, string | number> = {}) =>
    Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key, typeof value === "number" ? formatNumber(value, i18n.language) : value]),
    );
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const again = useMutation({
    mutationFn: () => doctorApi.startExam(exam.patient_id, exam.device_id, exam.point),
    onSuccess: (next) => {
      queryClient.setQueryData(["exam", next.id], next);
      void queryClient.invalidateQueries({ queryKey: ["patientExams", exam.patient_id] });
      navigate(`/doctor/exams/${next.id}`, { replace: true });
    },
  });
  const cancelled = state.reasons[0]?.key === "exam.failure.cancelled";
  return (
    <div className="flex flex-col gap-4">
      <h2 id="live-title" className={clsx("text-title font-semibold", !cancelled && "text-danger")}>
        {cancelled ? t("live.cancelledTitle") : t("live.failedTitle")}
      </h2>
      <ul className="flex flex-col gap-1.5 text-ink-700">
        {state.reasons.map((reason) => (
          <li key={reason.key} className="flex gap-2">
            <span aria-hidden="true" className="text-danger">
              •
            </span>
            {t(reason.key, localized(reason.values))}
          </li>
        ))}
      </ul>
      {again.isError && <Alert tone="danger">{t(errorMessage(again.error).key)}</Alert>}
      <div>
        <Button variant="primary" busy={again.isPending} busyText={t("newExam.starting")} onClick={() => again.mutate()}>
          {t("live.recordAgain")}
        </Button>
      </div>
    </div>
  );
}
