import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { type MyExam, patientApi } from "../../api/patient";
import { ErrorState, SkeletonRows } from "../../components/ui/States";
import { formatDate, formatNumber, initials } from "../../lib/format";
import { Avatar, Button, StatusChip } from "../../redesign/components";
import { heartRateLevel } from "../doctor/patients/vitalStatus";
import { groupVisits, summarize, type Visit } from "./visits";

/** Status of one position, from what the AI said and the doctor reviewed. "Reviewed" when the AI gave no answer. */
function useFinding() {
  const { t } = useTranslation();
  return (exam: MyExam) => {
    if (exam.ai_label === "murmur")
      return { text: t("portal.results.findingMurmur"), chip: <StatusChip status="abnormal" label={t("portal.results.statusMurmur")} /> };
    if (exam.ai_label === "absent")
      return { text: t("portal.results.findingAbsent"), chip: <StatusChip status="normal" label={t("portal.results.statusNormal")} /> };
    return {
      text: t("portal.results.findingNone"),
      chip: <span className="rd-chip rd-chip--plain">{t("portal.results.statusReviewed")}</span>,
    };
  };
}

/**
 * The patient's results (design "Patient results"): the latest visit first — heart rate, murmur screening, recording
 * quality, one row per listening position, the doctor's note and the recording — then earlier visits. Every exam here
 * is already reviewed; the AI shows only its yes / no label, marked "AI-assisted".
 */
export function ResultsPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const profile = useQuery({ queryKey: ["me"], queryFn: patientApi.profile });
  const exams = useQuery({ queryKey: ["myExams"], queryFn: patientApi.exams });
  const [visitKey, setVisitKey] = useState<string | null>(null);
  const [examId, setExamId] = useState<number | null>(null);
  const finding = useFinding();

  if (exams.isError && !exams.data) return <ErrorState error={exams.error} onRetry={() => void exams.refetch()} />;
  if (!exams.data) return <SkeletonRows rows={4} label={t("common.loading")} />;

  const title = <h1 className="rd-h1">{t("portal.results.title")}</h1>;
  const visits = groupVisits(exams.data);
  // With no results the page keeps its whole layout (design "Patient results"); every block shows an empty state.
  const visit: Visit | null = visits.find((v) => v.key === visitKey) ?? visits[0] ?? null;
  const selected = visit ? (visit.exams.find((e) => e.id === examId) ?? visit.exams.find((e) => e.ai_label === "murmur") ?? visit.exams[0]) : null;
  const earlier = visits.filter((v) => v.key !== visit?.key);
  const sum = summarize(visit?.exams ?? []);
  const doctor = visit?.exams[0].doctor_name ?? "";
  const visitClinic = visit?.exams[0].clinic ?? null;
  const hr = profile.data?.heart_rate ?? null;
  const pointName = (e: MyExam) => t(`exam.point.${e.point}`);
  const open = (v: Visit) => {
    setVisitKey(v.key);
    setExamId(null);
    window.scrollTo({ top: 0 });
  };
  const empty = (
    <div className="pt-empty">
      <p className="rd-label">{t("portal.results.emptyTitle")}</p>
      <p className="rd-sm">{t("portal.results.emptyBody")}</p>
    </div>
  );

  return (
    <div className="pt-page">
      <div className="pt-titlebar">
        <div className="pt-titlebar__text">
          {title}
          <p className="rd-sm">
            {profile.data?.clinic && `${t("portal.results.registered", { clinic: profile.data.clinic })} `}
            {profile.data && t("portal.results.intro", { doctor: profile.data.doctor_name })}
          </p>
        </div>
        <Button icon="download" className="pt-noprint" disabled={!visit} onClick={() => window.print()}>
          {t("portal.results.download")}
        </Button>
      </div>

      <div className="pt-cards">
        <section className="pt-stat" aria-labelledby="pt-hr">
          <h2 className="rd-cap" id="pt-hr">
            {t("portal.results.hrTitle")}
          </h2>
          <p className="pt-stat__value">
            {hr === null ? "—" : formatNumber(hr, lang)}
            {hr !== null && <span className="pt-stat__unit">{t("portal.results.hrUnit")}</span>}
          </p>
          <p className="rd-sm">
            {hr === null || !profile.data?.heart_rate_at
              ? t("portal.results.hrNone")
              : `${t("portal.results.hrRef")} · ${t("portal.results.hrMeasured", { date: formatDate(profile.data.heart_rate_at, lang) })}`}
          </p>
          {hr !== null && (
            <span className="pt-stat__chip">
              {heartRateLevel(hr) === "normal" ? (
                <StatusChip status="normal" label={t("portal.results.hrNormal")} />
              ) : (
                <StatusChip status="borderline" label={t("portal.results.hrOutside")} />
              )}
            </span>
          )}
        </section>

        <section className="pt-stat" aria-labelledby="pt-murmur">
          <h2 className="rd-cap" id="pt-murmur">
            {t("portal.results.murmurTitle")}
          </h2>
          <p className="pt-stat__value">
            {sum.answered === 0
              ? "—"
              : sum.murmur === 0
                ? t("portal.results.murmurNone")
                : t("portal.results.murmurCount", { count: sum.murmur, total: sum.answered })}
          </p>
          <p className="rd-sm">
            {!visit
              ? t("portal.results.emptyTitle")
              : sum.answered === 0
              ? t("portal.results.murmurNoAnswer")
              : sum.murmur === 0
                ? t("portal.results.murmurSubNone")
                : t("portal.results.murmurSub")}
          </p>
          {visit && <span className="pt-stat__chip">
            {sum.answered === 0 ? (
              <span className="rd-chip rd-chip--plain">{t("portal.results.murmurChipNoAnswer")}</span>
            ) : sum.murmur === 0 ? (
              <StatusChip status="normal" label={t("portal.results.murmurChipNone")} />
            ) : (
              <StatusChip status="abnormal" label={t("portal.results.murmurChipFlag")} />
            )}
          </span>}
        </section>

        <section className="pt-stat" aria-labelledby="pt-quality">
          <h2 className="rd-cap" id="pt-quality">
            {t("portal.results.qualityTitle")}
          </h2>
          <p className="pt-stat__value">{visit ? t("portal.results.qualityValue", { good: sum.good, total: sum.total }) : "—"}</p>
          <p className="rd-sm">{visit ? t("portal.results.qualitySub") : t("portal.results.emptyTitle")}</p>
          {visit && (
            <span className="pt-stat__chip">
              {sum.good === sum.total ? (
                <StatusChip status="normal" label={t("portal.results.qualityOk")} />
              ) : (
                <StatusChip status="borderline" label={t("portal.results.qualityRepeat")} />
              )}
            </span>
          )}
        </section>
      </div>

      <div className="pt-cols">
        <div className="pt-cols__main">
        <section className="pt-block" aria-labelledby="pt-positions">
          <div className="pt-block__head">
            <div className="pt-cell">
              <h2 className="rd-h3" id="pt-positions">
                {t("portal.results.positionsTitle")}
              </h2>
              {visit && <p className="rd-sm">
                {visitClinic
                  ? t("portal.results.visitLine", { date: formatDate(visit.date, lang), clinic: visitClinic, doctor })
                  : t("portal.results.visitLineNoClinic", { date: formatDate(visit.date, lang), doctor })}
              </p>}
            </div>
            {sum.answered > 0 && <StatusChip status="ai" label={t("portal.results.ai")} />}
          </div>

          {!visit || !selected ? (
            <>
              <div className="pt-scroll">
                <table className="pt-table">
                  <thead>
                    <tr>
                      <th scope="col">{t("portal.results.colPosition")}</th>
                      <th scope="col">{t("portal.results.colAnalyzed")}</th>
                      <th scope="col">{t("portal.results.colFinding")}</th>
                      <th scope="col">{t("portal.results.colStatus")}</th>
                      <th scope="col">
                        <span className="rd-sr">{t("portal.results.colDetails")}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td colSpan={5}>{empty}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="pt-positions">{empty}</div>
            </>
          ) : (
            <>
          <div className="pt-scroll">
            <table className="pt-table">
              <thead>
                <tr>
                  <th scope="col">{t("portal.results.colPosition")}</th>
                  <th scope="col">{t("portal.results.colAnalyzed")}</th>
                  <th scope="col">{t("portal.results.colFinding")}</th>
                  <th scope="col">{t("portal.results.colStatus")}</th>
                  <th scope="col">
                    <span className="rd-sr">{t("portal.results.colDetails")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visit.exams.map((e) => {
                  const f = finding(e);
                  const isSelected = e.id === selected.id;
                  return (
                    <tr key={e.id} data-selected={isSelected}>
                      <td>
                        <span className="pt-cell">
                          <span className="pt-ink">{e.point}</span>
                          <span className="rd-sm">{pointName(e)}</span>
                        </span>
                      </td>
                      <td>
                        <span className="pt-cell">
                          <span>{e.clinic ?? "—"}</span>
                          {e.device_code && <span className="rd-sm">{t("portal.results.device", { code: e.device_code })}</span>}
                        </span>
                      </td>
                      <td>{f.text}</td>
                      <td>{f.chip}</td>
                      <td>
                        {isSelected ? (
                          <span className="rd-label">{t("portal.results.viewing")}</span>
                        ) : (
                          <Button variant="ghost" onClick={() => setExamId(e.id)} aria-label={`${t("portal.results.details")}: ${e.point}`}>
                            {t("portal.results.details")}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <ul className="pt-positions">
            {visit.exams.map((e) => {
              const f = finding(e);
              const isSelected = e.id === selected.id;
              return (
                <li key={e.id} className="pt-position" data-selected={isSelected}>
                  <div className="pt-position__top">
                    <span className="pt-ink">
                      {e.point} · {pointName(e)}
                    </span>
                    {f.chip}
                  </div>
                  <p className="rd-sm">{f.text}</p>
                  {!isSelected && (
                    <Button variant="secondary" onClick={() => setExamId(e.id)} aria-label={`${t("portal.results.details")}: ${e.point}`}>
                      {t("portal.results.details")}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
            </>
          )}
        </section>

        <section className="pt-block pt-noprint" aria-labelledby="pt-earlier">
            <div className="pt-block__head">
              <h2 className="rd-h3" id="pt-earlier">
                {t("portal.results.earlierTitle")}
              </h2>
            </div>
            {earlier.length === 0 && <p className="rd-sm" style={{ padding: "var(--s-5)" }}>{t("portal.results.earlierNone")}</p>}
            <ul className="pt-visits">
              {earlier.map((v) => {
                const s = summarize(v.exams);
                return (
                  <li key={v.key} className="pt-visit">
                    <div className="pt-cell">
                      <span className="pt-ink">{formatDate(v.date, lang)}</span>
                      <span className="rd-sm">
                        {[t("portal.results.positionsCount", { count: v.exams.length }), v.exams[0].doctor_name, v.exams[0].clinic]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </div>
                    <div className="pt-visit__end">
                      {s.murmur > 0 ? (
                        <StatusChip status="abnormal" label={t("portal.results.statusMurmur")} />
                      ) : s.answered > 0 ? (
                        <StatusChip status="normal" label={t("portal.results.statusNormal")} />
                      ) : (
                        <span className="rd-chip rd-chip--plain">{t("portal.results.statusReviewed")}</span>
                      )}
                      <Button variant="secondary" onClick={() => open(v)} aria-label={t("portal.results.viewVisit", { date: formatDate(v.date, lang) })}>
                        {t("portal.results.view")}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        <div className="pt-cols__side">
        <section className="pt-block" aria-labelledby="pt-note">
          <div className="pt-block__head">
            <h2 className="rd-h3" id="pt-note">
              {t("portal.results.noteTitle")}
            </h2>
          </div>
          <div className="pt-block__body">
            {!selected ? empty : (<>
            <div className="pt-doctor">
              <Avatar initials={initials(selected.doctor_name)} soft />
              <div className="pt-cell">
                <span className="rd-label">{selected.doctor_name}</span>
                <span className="rd-sm">
                  {selected.clinic ? `${selected.clinic} · ` : ""}
                  {formatDate(selected.reviewed_at, lang)}
                </span>
              </div>
            </div>
            <p className="pt-note">{selected.doctor_note}</p>
            </>)}
          </div>
        </section>
        </div>
      </div>
    </div>
  );
}
