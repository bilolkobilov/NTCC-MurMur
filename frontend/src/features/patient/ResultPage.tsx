import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";

import { patientApi } from "../../api/patient";
import { ChestMap } from "../../components/exam/ChestDiagram";
import { ButtonLink } from "../../components/ui/Button";
import { EmptyState, ErrorState, SkeletonRows } from "../../components/ui/States";
import { formatDate, formatDateTime } from "../../lib/format";

/**
 * One reviewed result: the doctor's conclusion first (what the patient came for), then where the doctor listened.
 * Read from the same list as the home page — the API has no single-result endpoint and a patient has few results.
 * Only fields of `MyExam` are rendered: the backend sends no AI fields, and this page would not show them if it did.
 */
export function ResultPage() {
  const id = Number(useParams().examId);
  const { t, i18n } = useTranslation();
  const profile = useQuery({ queryKey: ["me"], queryFn: patientApi.profile });
  const exams = useQuery({ queryKey: ["myExams"], queryFn: patientApi.exams });
  const exam = exams.data?.find((e) => e.id === id);

  const back = (
    <Link to="/patient" className="mb-3 inline-flex min-h-11 items-center text-label text-ink-500 hover:text-ink-900">
      ← {t("myResult.back")}
    </Link>
  );

  if (!exams.data) {
    return (
      <div className="mx-auto max-w-2xl">
        {back}
        {exams.isError ? (
          <ErrorState error={exams.error} onRetry={() => void exams.refetch()} />
        ) : (
          <SkeletonRows rows={3} label={t("common.loading")} />
        )}
      </div>
    );
  }
  if (!exam) {
    return (
      <div className="mx-auto max-w-2xl">
        {back}
        <EmptyState
          title={t("myResult.notFoundTitle")}
          body={t("myResult.notFoundBody")}
          action={<ButtonLink to="/patient">{t("myResult.back")}</ButtonLink>}
        />
      </div>
    );
  }

  const pointName = t(`exam.point.${exam.point}`);
  return (
    <div className="mx-auto max-w-2xl">
      {back}
      <h1 className="text-headline font-semibold">
        {t("myResult.title", { date: formatDate(exam.created_at, i18n.language) })}
      </h1>
      <p className="mt-1 text-ink-500">
        {t("myResult.reviewedBy", {
          doctor: profile.data?.doctor_name ?? "…",
          date: formatDateTime(exam.reviewed_at, i18n.language),
        })}
      </p>

      <section aria-labelledby="conclusion" className="mt-6 rounded-card border border-line bg-surface p-5 sm:p-6">
        <h2 id="conclusion" className="text-label font-semibold tracking-wide text-ink-500 uppercase">
          {t("myResult.conclusion")}
        </h2>
        <p className="mt-3 text-[17px] leading-7 whitespace-pre-wrap text-ink-900 [overflow-wrap:anywhere]">
          {exam.doctor_note}
        </p>
      </section>

      <section aria-labelledby="where" className="mt-4 rounded-card border border-line bg-surface p-5 sm:p-6">
        <h2 id="where" className="text-label font-semibold tracking-wide text-ink-500 uppercase">
          {t("myResult.where")}
        </h2>
        <div className="mt-4 grid items-center gap-5 sm:grid-cols-[180px_minmax(0,1fr)]">
          <ChestMap
            point={exam.point}
            label={t("myResult.mapLabel", { point: pointName })}
            className="mx-auto max-w-[180px]"
          />
          <div>
            <p className="font-semibold text-ink-900">
              <span translate="no" className="font-mono">
                {exam.point}
              </span>{" "}
              · {pointName}
            </p>
            <p className="mt-1 text-ink-700">{t(`chest.patientWhere.${exam.point}`)}</p>
            <p className="mt-3 text-caption text-ink-500">
              {t("myResult.orientation", { right: t("chest.patientRightShort") })}
            </p>
          </div>
        </div>
      </section>

      <p className="mt-6 text-ink-700">{t("myResult.questions")}</p>
      <p className="mt-2 text-caption text-ink-500">{t("patientHome.disclaimer")}</p>
    </div>
  );
}
