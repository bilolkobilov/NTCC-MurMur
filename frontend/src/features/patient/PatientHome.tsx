import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { patientApi } from "../../api/patient";
import { EmptyState, ErrorState, SkeletonRows } from "../../components/ui/States";
import { formatDate } from "../../lib/format";

/**
 * The patient's phone home: their reviewed results, newest first. Calm and plain — no AI words, no statuses (a patient
 * only ever sees reviewed exams), one job: open a result.
 */
export function PatientHome() {
  const { t, i18n } = useTranslation();
  const profile = useQuery({ queryKey: ["me"], queryFn: patientApi.profile });
  const exams = useQuery({ queryKey: ["myExams"], queryFn: patientApi.exams });

  return (
    <div className="mx-auto max-w-2xl">
      <p className="text-label text-ink-500">{profile.data?.full_name ?? " "}</p>
      <h1 className="mt-1 text-headline font-semibold">{t("patientHome.title")}</h1>
      {profile.data && (
        <p className="mt-2 text-ink-700">{t("patientHome.intro", { doctor: profile.data.doctor_name })}</p>
      )}

      <div className="mt-6 overflow-hidden rounded-card border border-line bg-surface">
        {exams.isPending && <SkeletonRows rows={3} label={t("common.loading")} />}
        {exams.isError && !exams.data && <ErrorState error={exams.error} onRetry={() => void exams.refetch()} />}
        {exams.data?.length === 0 && <EmptyState title={t("patientHome.emptyTitle")} body={t("patientHome.emptyBody")} />}
        {exams.data && exams.data.length > 0 && (
          <ul className="divide-y divide-line">
            {exams.data.map((exam) => (
              <li key={exam.id}>
                <Link to={`/patient/results/${exam.id}`} className="row-link flex flex-col gap-1.5 px-4 py-4 sm:px-5">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold text-ink-900 tabular-nums">
                      {formatDate(exam.created_at, i18n.language)}
                    </span>
                    <span aria-hidden="true" className="text-ink-300">
                      →
                    </span>
                  </span>
                  <span className="text-label text-ink-500">
                    {t("patientHome.point", { point: t(`exam.point.${exam.point}`) })}
                  </span>
                  <span className="line-clamp-2 text-ink-700 [overflow-wrap:anywhere]">{exam.doctor_note}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="mt-6 text-caption text-ink-500">{t("patientHome.disclaimer")}</p>
    </div>
  );
}
