import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { adminApi } from "../../api/admin";
import type { ExamStatus } from "../../api/doctor";
import { StatusMark } from "../../components/exam/StatusMark";
import { ErrorState, Panel, SkeletonRows } from "../../components/ui/States";
import { formatNumber, formatRelative } from "../../lib/format";
import { OnlineBadge } from "../../components/device/OnlineBadge";

const STATUSES: ExamStatus[] = ["waiting", "recording", "uploaded", "analyzed", "reviewed", "failed"];

/**
 * Admin home: is the system working right now? Focal point = exams today and where they are in the pipeline;
 * devices and the AI model beside it. Counts only — the admin never sees patients' medical data.
 */
export function AdminHome() {
  const { t, i18n } = useTranslation();
  const stats = useQuery({ queryKey: ["admin", "stats"], queryFn: adminApi.stats, refetchInterval: 15_000 });
  const devices = useQuery({ queryKey: ["admin", "devices"], queryFn: adminApi.devices, refetchInterval: 10_000 });
  const n = (value: number) => formatNumber(value, i18n.language);

  if (!stats.data) {
    return stats.isError ? (
      <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />
    ) : (
      <SkeletonRows rows={4} label={t("common.loading")} />
    );
  }
  const s = stats.data;
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section aria-labelledby="today-title">
        <p className="text-label font-semibold tracking-wide text-ink-500 uppercase">{t("adminHome.todayLabel")}</p>
        <h1 id="today-title" className="mt-1 text-display font-semibold tabular-nums">
          {t("adminHome.examsToday", { count: s.exams_today, formatted: n(s.exams_today) })}
        </h1>
        <p className="mt-1 text-ink-500">{t("adminHome.privacy")}</p>

        <div className="mt-5">
          <Panel title={t("adminHome.byStatus")}>
            <ul className="divide-y divide-line">
              {STATUSES.map((status) => (
                <li key={status} className="flex min-h-12 items-center justify-between gap-4 px-4">
                  <StatusMark status={status} label={status === "analyzed" ? t("adminHome.awaitingReview") : undefined} />
                  <span className="font-mono text-body text-ink-900 tabular-nums">{n(s.exams_by_status[status] ?? 0)}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line">
          {[
            [t("adminHome.doctors"), t("adminHome.activeOf", { active: n(s.doctors_active), total: n(s.doctors_total) }), "/admin/doctors"],
            [t("adminHome.patients"), n(s.patients_total), null],
          ].map(([label, value, to]) => (
            <div key={label} className="bg-surface px-4 py-3">
              <dt className="text-label text-ink-500">{label}</dt>
              <dd className="mt-0.5 text-title font-semibold tabular-nums">
                {to ? (
                  <Link to={to} className="underline decoration-line-strong underline-offset-4 hover:decoration-ink-900">
                    {value}
                  </Link>
                ) : (
                  value
                )}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="flex flex-col gap-6">
        <Panel
          title={t("adminHome.devicesTitle")}
          actions={
            <Link to="/admin/devices" className="inline-flex min-h-11 items-center text-label text-ink-500 hover:text-ink-900">
              {t("adminHome.manage")}
            </Link>
          }
        >
          <p className="border-b border-line px-4 py-2.5 text-label text-ink-700 tabular-nums">
            {t("devices.onlineOf", { online: n(s.devices_online), total: n(s.devices_total) })}
          </p>
          {devices.data?.length === 0 && <p className="px-4 py-4 text-ink-500">{t("adminHome.noDevices")}</p>}
          <ul className="divide-y divide-line">
            {devices.data?.slice(0, 6).map((device) => (
              <li key={device.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{device.name}</span>
                  <span className="block text-caption text-ink-500">
                    {device.last_seen_at
                      ? t("device.lastSeen", { when: formatRelative(device.last_seen_at, i18n.language) })
                      : t("device.never")}
                  </span>
                </span>
                <OnlineBadge online={device.online} />
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title={t("adminHome.aiModel")}>
          <p className="px-4 pt-3 font-mono text-body text-ink-900" translate="no">
            {s.analyzer.name} {s.analyzer.version}
          </p>
          <p className="px-4 pt-1 pb-4 text-caption text-ink-500">
            {s.analyzer.name === "dummy" ? t("adminHome.aiOff") : t("adminHome.aiOn")}
          </p>
        </Panel>
      </div>
    </div>
  );
}
