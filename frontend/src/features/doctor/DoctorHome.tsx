import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { doctorApi } from "../../api/doctor";
import { StatusMark } from "../../components/exam/StatusMark";
import { ButtonLink } from "../../components/ui/Button";
import { EmptyState, ErrorState, Panel, SkeletonRows } from "../../components/ui/States";
import { formatRelative } from "../../lib/format";
import { OnlineBadge } from "../../components/device/OnlineBadge";
import { PointLabel } from "./shared";

/**
 * Doctor home. Focal point: the review queue — the one job the doctor comes here for. Devices and recent exams are
 * supporting context in a narrower column. No KPI-card row (see .interface-design/system.md, rejected defaults).
 */
export function DoctorHome() {
  const { t, i18n } = useTranslation();
  const queue = useQuery({
    queryKey: ["exams", "analyzed"],
    queryFn: () => doctorApi.listExams("analyzed", 50),
    refetchInterval: 15_000,
  });
  const recent = useQuery({ queryKey: ["exams", "recent"], queryFn: () => doctorApi.listExams(undefined, 6) });
  const devices = useQuery({ queryKey: ["devices"], queryFn: doctorApi.myDevices, refetchInterval: 10_000 });

  const count = queue.data?.length ?? 0;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section aria-labelledby="queue-title">
        <p className="text-label font-semibold tracking-wide text-ink-500 uppercase">{t("doctorHome.queueLabel")}</p>
        <h1 id="queue-title" className="mt-1 text-display font-semibold">
          {queue.isPending
            ? t("doctorHome.queueLoading")
            : count === 0
              ? t("doctorHome.queueNone")
              : t("doctorHome.queueCount", { count })}
        </h1>
        <div className="mt-5 rounded-card border border-line bg-surface">
          {queue.isPending && <SkeletonRows rows={3} label={t("common.loading")} />}
          {queue.isError && !queue.data && <ErrorState error={queue.error} onRetry={() => void queue.refetch()} />}
          {queue.data && count === 0 && (
            <EmptyState
              title={t("doctorHome.queueEmptyTitle")}
              body={t("doctorHome.queueEmptyBody")}
              action={
                <ButtonLink to="/doctor/patients">{t("doctorHome.openPatients")}</ButtonLink>
              }
            />
          )}
          {queue.data && count > 0 && (
            <ul className="divide-y divide-line">
              {queue.data.map((exam) => (
                <li key={exam.id}>
                  <Link
                    to={`/doctor/exams/${exam.id}`}
                    className="row-link grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto]"
                  >
                    <StatusMark status={exam.status} compact />
                    <span className="min-w-0 truncate font-semibold">{exam.patient_full_name}</span>
                    <span className="hidden sm:inline">
                      <PointLabel point={exam.point} short />
                    </span>
                    <span className="text-caption text-ink-500 tabular-nums">
                      {formatRelative(exam.created_at, i18n.language)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <div className="flex flex-col gap-6">
        <Panel title={t("doctorHome.devices")}>
          {devices.isPending && <SkeletonRows rows={2} label={t("common.loading")} />}
          {devices.isError && !devices.data && <ErrorState error={devices.error} onRetry={() => void devices.refetch()} />}
          {devices.data && devices.data.length === 0 && (
            <p className="px-4 py-4 text-ink-500">{t("doctorHome.noDevices")}</p>
          )}
          {devices.data && devices.data.length > 0 && (
            <ul className="divide-y divide-line">
              {devices.data.map((device) => (
                <li key={device.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{device.name}</span>
                    <span translate="no" className="font-mono text-caption text-ink-500">
                      {device.serial}
                    </span>
                  </span>
                  <span className="flex flex-col items-end">
                    <OnlineBadge online={device.online} />
                    {!device.online && device.last_seen_at && (
                      <span className="text-caption text-ink-500 tabular-nums">
                        {formatRelative(device.last_seen_at, i18n.language)}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={t("doctorHome.recent")}>
          {recent.isPending && <SkeletonRows rows={3} label={t("common.loading")} />}
          {recent.isError && !recent.data && <ErrorState error={recent.error} onRetry={() => void recent.refetch()} />}
          {recent.data && recent.data.length === 0 && (
            <p className="px-4 py-4 text-ink-500">{t("doctorHome.noRecent")}</p>
          )}
          {recent.data && recent.data.length > 0 && (
            <ul className="divide-y divide-line">
              {recent.data.map((exam) => (
                <li key={exam.id}>
                  <Link to={`/doctor/exams/${exam.id}`} className="row-link flex flex-col gap-1 px-4 py-3">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate font-medium">{exam.patient_full_name}</span>
                      <PointLabel point={exam.point} short />
                    </span>
                    <span className="flex items-center justify-between gap-3">
                      <StatusMark status={exam.status} />
                      <span className="text-caption text-ink-500 tabular-nums">
                        {formatRelative(exam.created_at, i18n.language)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
