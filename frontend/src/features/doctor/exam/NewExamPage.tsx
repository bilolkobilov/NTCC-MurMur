import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { type FormEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";

import { errorMessage } from "../../../api/client";
import { type DoctorDevice, doctorApi, type Point } from "../../../api/doctor";
import { Alert } from "../../../components/ui/Alert";
import { Button, ButtonLink } from "../../../components/ui/Button";
import { EmptyState, ErrorState, PageHeader, SkeletonRows } from "../../../components/ui/States";
import { formatRelative } from "../../../lib/format";
import { OnlineBadge } from "../../../components/device/OnlineBadge";
import { ChestPointPicker } from "./ChestPointPicker";
import { RECORD_SECONDS } from "./liveState";

/**
 * Start an exam: pick a device (online first; offline ones explain why they can't be used) and a chest point.
 * Focal point: the chest drawing — it is the decision the doctor makes here.
 */
export function NewExamPage() {
  const patientId = Number(useParams().patientId);
  const { t } = useTranslation();
  const patient = useQuery({ queryKey: ["patient", patientId], queryFn: () => doctorApi.getPatient(patientId) });
  const devices = useQuery({ queryKey: ["devices"], queryFn: doctorApi.myDevices, refetchInterval: 5_000 });

  if (!patient.data || !devices.data) {
    const failed = patient.isError ? patient : devices.isError ? devices : null;
    if (failed) return <ErrorState error={failed.error} onRetry={() => void failed.refetch()} />;
    return <SkeletonRows rows={4} label={t("common.loading")} />;
  }
  const back = `/doctor/patients/${patientId}`;
  if (!patient.data.consent_given_at) {
    return (
      <div className="mx-auto max-w-xl">
        <PageHeader title={t("newExam.title")} meta={patient.data.full_name} />
        <EmptyState
          title={t("patient.consentMissingTitle")}
          body={t("patient.consentMissingBody")}
          action={<ButtonLink to={back}>{t("newExam.backToPatient")}</ButtonLink>}
        />
      </div>
    );
  }
  return <NewExamForm patientId={patientId} patientName={patient.data.full_name} devices={devices.data} back={back} />;
}

function NewExamForm({
  patientId,
  patientName,
  devices,
  back,
}: {
  patientId: number;
  patientName: string;
  devices: DoctorDevice[];
  back: string;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const sorted = [...devices].sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
  const online = sorted.filter((d) => d.online);
  const [deviceId, setDeviceId] = useState<number | null>(online.length === 1 ? online[0].id : null);
  const [point, setPoint] = useState<Point | null>(null);
  const [problems, setProblems] = useState<{ device?: string; point?: string }>({});
  const deviceRef = useRef<HTMLInputElement>(null);
  const pointRef = useRef<HTMLInputElement>(null);

  const start = useMutation({
    mutationFn: () => doctorApi.startExam(patientId, deviceId!, point!),
    onSuccess: (exam) => {
      queryClient.setQueryData(["exam", exam.id], exam);
      void queryClient.invalidateQueries({ queryKey: ["patientExams", patientId] });
      navigate(`/doctor/exams/${exam.id}`, { replace: true });
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (start.isPending) return;
    const chosen = sorted.find((d) => d.id === deviceId);
    const found = {
      device: !chosen ? t("newExam.chooseDevice") : !chosen.online ? t("newExam.deviceWentOffline") : undefined,
      point: point ? undefined : t("newExam.choosePoint"),
    };
    setProblems(found);
    if (found.device) return deviceRef.current?.focus();
    if (found.point) return pointRef.current?.focus();
    start.mutate();
  };
  const failure = start.isError ? errorMessage(start.error) : null;

  if (devices.length === 0) {
    return (
      <div className="mx-auto max-w-xl">
        <PageHeader title={t("newExam.title")} meta={patientName} />
        <EmptyState
          title={t("newExam.noDevicesTitle")}
          body={t("doctorHome.noDevices")}
          action={<ButtonLink to={back}>{t("newExam.backToPatient")}</ButtonLink>}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link to={back} className="mb-3 inline-flex min-h-11 items-center text-label text-ink-500 hover:text-ink-900">
        ← {patientName}
      </Link>
      <PageHeader title={t("newExam.title")} meta={t("newExam.lead", { seconds: RECORD_SECONDS })} />
      <form onSubmit={submit} noValidate className="rounded-card border border-line bg-surface">
        <div className="flex flex-col gap-8 p-6">
          {failure && <Alert tone="danger">{t(failure.key, failure.values ?? {})}</Alert>}

          <fieldset aria-describedby={problems.device ? "device-error" : undefined}>
            <legend className="text-label font-medium text-ink-700 after:ml-1 after:text-ink-300 after:content-['*']">
              {t("newExam.device")}
            </legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {sorted.map((device, index) => (
                <label
                  key={device.id}
                  className={clsx(
                    "flex min-h-16 items-center justify-between gap-3 rounded-control border px-4 py-3",
                    "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink-900",
                    device.online ? "cursor-pointer" : "cursor-not-allowed bg-canvas",
                    deviceId === device.id ? "border-ink-900 shadow-[inset_0_0_0_1px_var(--color-ink-900)]" : "border-line-strong",
                  )}
                >
                  <input
                    ref={index === 0 ? deviceRef : undefined}
                    type="radio"
                    name="device"
                    value={device.id}
                    disabled={!device.online}
                    checked={deviceId === device.id}
                    onChange={() => setDeviceId(device.id)}
                    className="sr-only"
                  />
                  <span className="min-w-0">
                    <span className={clsx("block truncate font-medium", !device.online && "text-ink-500")}>{device.name}</span>
                    <span translate="no" className="font-mono text-caption text-ink-500">
                      {device.serial}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end text-right">
                    <OnlineBadge online={device.online} />
                    {!device.online && (
                      <span className="text-caption text-ink-500">
                        {device.last_seen_at
                          ? t("device.lastSeen", { when: formatRelative(device.last_seen_at, i18n.language) })
                          : t("device.never")}
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>
            {online.length === 0 && <p className="mt-2 text-caption text-ink-500">{t("newExam.allOffline")}</p>}
            {problems.device && (
              <p id="device-error" className="mt-2 text-caption font-medium text-danger">
                {problems.device}
              </p>
            )}
          </fieldset>

          <ChestPointPicker value={point} onChange={setPoint} error={problems.point} firstRef={pointRef} />
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-line px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-caption text-ink-500">{t("newExam.whatHappens", { seconds: RECORD_SECONDS })}</p>
          <Button type="submit" variant="primary" busy={start.isPending} busyText={t("newExam.starting")}>
            {t("newExam.start")}
          </Button>
        </div>
      </form>
    </div>
  );
}
