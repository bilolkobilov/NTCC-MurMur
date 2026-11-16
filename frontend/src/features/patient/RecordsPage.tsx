import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { patientApi } from "../../api/patient";
import { EmptyState, ErrorState, SkeletonRows } from "../../components/ui/States";
import { formatDate } from "../../lib/format";
import { Button, ButtonLink } from "../../redesign/components";
import { groupVisits } from "./visits";

/** Every reviewed result and note on one printable page. "Save as PDF" is the browser's print dialog (no extra software). */
export function RecordsPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const profile = useQuery({ queryKey: ["me"], queryFn: patientApi.profile });
  const exams = useQuery({ queryKey: ["myExams"], queryFn: patientApi.exams });

  if (exams.isError && !exams.data) return <ErrorState error={exams.error} onRetry={() => void exams.refetch()} />;
  if (!exams.data) return <SkeletonRows rows={4} label={t("common.loading")} />;
  const visits = groupVisits(exams.data);

  return (
    <div className="pt-page">
      <div className="pt-titlebar">
        <div className="pt-titlebar__text">
          <h1 className="rd-h1">{t("portal.records.title")}</h1>
          <p className="rd-sm">
            {profile.data?.full_name} · {t("portal.records.generated", { date: formatDate(new Date().toISOString(), lang) })}
          </p>
          <p className="rd-sm pt-noprint">{t("portal.records.intro")}</p>
        </div>
        <div className="pt-visit__end pt-noprint">
          <ButtonLink to="/patient/profile">{t("portal.records.back")}</ButtonLink>
          <Button variant="primary" icon="download" onClick={() => window.print()}>
            {t("portal.records.print")}
          </Button>
        </div>
      </div>

      {visits.length === 0 && <EmptyState title={t("portal.results.emptyTitle")} body={t("portal.records.empty")} />}
      {visits.map((visit) => (
        <section key={visit.key} className="pt-block" aria-label={formatDate(visit.date, lang)}>
          <div className="pt-block__head">
            <h2 className="rd-h3">{formatDate(visit.date, lang)}</h2>
            <span className="rd-sm">{[visit.exams[0].doctor_name, visit.exams[0].clinic].filter(Boolean).join(" · ")}</span>
          </div>
          <ul className="pt-visits">
            {visit.exams.map((e) => (
              <li key={e.id} className="pt-visit" style={{ alignItems: "flex-start" }}>
                <div className="pt-cell" style={{ flex: "1 1 320px" }}>
                  <span className="pt-ink">
                    {e.point} · {t(`exam.point.${e.point}`)}
                  </span>
                  <span className="rd-sm">
                    {e.ai_label === "murmur"
                      ? t("portal.results.findingMurmur")
                      : e.ai_label === "absent"
                        ? t("portal.results.findingAbsent")
                        : t("portal.results.findingNone")}
                  </span>
                  <p className="pt-note" style={{ marginTop: 8 }}>
                    {e.doctor_note}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="rd-sm">{t("portal.disclaimer")}</p>
    </div>
  );
}
