import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useSearchParams } from "react-router";

import { doctorApi, type Patient, PAGE_SIZE } from "../../../api/doctor";
import { Alert } from "../../../components/ui/Alert";
import { Button, ButtonLink } from "../../../components/ui/Button";
import { EmptyState, ErrorState, PageHeader, SkeletonRows } from "../../../components/ui/States";
import { ageFromBirthYear, formatNumber } from "../../../lib/format";
import { RecordNo } from "../shared";

/**
 * Patients list. Dense, hairline rows (scanned, not read). Search lives in the URL (?q=) so reload/back keep it.
 * Paging: "Show more" loads the next 50 — no infinite scroll, so the footer and the count stay reachable.
 */
export function PatientsPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const urlQuery = params.get("q") ?? "";
  const [text, setText] = useState(urlQuery);

  // Typing updates the URL after a short pause (one request per pause, not per keystroke).
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (text.trim() !== urlQuery) {
        setParams(text.trim() ? { q: text.trim() } : {}, { replace: true });
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [text, urlQuery, setParams]);

  const patients = useInfiniteQuery({
    queryKey: ["patients", urlQuery],
    queryFn: ({ pageParam }) => doctorApi.listPatients(urlQuery, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, all) => (last.length === PAGE_SIZE ? all.length * PAGE_SIZE : undefined),
  });
  const rows = patients.data?.pages.flat() ?? [];
  const deleted = (useLocation().state as { deleted?: string } | null)?.deleted;

  return (
    <>
      <PageHeader
        title={t("patients.title")}
        actions={
          <ButtonLink to="/doctor/patients/new" variant="primary">
            {t("patients.add")}
          </ButtonLink>
        }
      />
      {deleted && (
        <div className="mb-4">
          <Alert tone="clear">{t("patients.deleted", { name: deleted })}</Alert>
        </div>
      )}
      <div className="rounded-card border border-line bg-surface">
        <div className="border-b border-line p-3">
          <label htmlFor="patient-search" className="sr-only">
            {t("patients.searchLabel")}
          </label>
          <input
            id="patient-search"
            type="search"
            name="q"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="search"
            placeholder={t("patients.searchPlaceholder")}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="min-h-11 w-full rounded-control border border-line-strong bg-field px-3 text-body placeholder:text-ink-300 focus:border-ink-900 focus:bg-surface focus:outline-2 focus:outline-offset-1 focus:outline-ink-900/15"
          />
        </div>

        {patients.isPending && <SkeletonRows rows={6} label={t("common.loading")} />}
        {patients.isError && <ErrorState error={patients.error} onRetry={() => void patients.refetch()} />}
        {patients.isSuccess && rows.length === 0 && !urlQuery && (
          <EmptyState
            title={t("patients.emptyTitle")}
            body={t("patients.emptyBody")}
            action={
              <ButtonLink to="/doctor/patients/new" variant="primary">
                {t("patients.add")}
              </ButtonLink>
            }
          />
        )}
        {patients.isSuccess && rows.length === 0 && urlQuery && (
          <EmptyState
            title={t("patients.noMatchTitle", { query: urlQuery })}
            body={t("patients.noMatchBody")}
            action={<Button onClick={() => setText("")}>{t("patients.clearSearch")}</Button>}
          />
        )}
        {rows.length > 0 && (
          <ul className="divide-y divide-line">
            {rows.map((patient) => (
              <PatientRow key={patient.id} patient={patient} />
            ))}
          </ul>
        )}
        {patients.hasNextPage && (
          <div className="border-t border-line p-3 text-center">
            <Button
              onClick={() => void patients.fetchNextPage()}
              busy={patients.isFetchingNextPage}
              busyText={t("common.loading")}
            >
              {t("patients.showMore")}
            </Button>
          </div>
        )}
      </div>
    </>
  );
}

function PatientRow({ patient }: { patient: Patient }) {
  const { t, i18n } = useTranslation();
  const facts = [
    t("patients.age", { count: ageFromBirthYear(patient.birth_year) }),
    t(`sex.${patient.sex}`),
    patient.height_cm ? t("units.cm", { value: formatNumber(patient.height_cm, i18n.language) }) : null,
    patient.weight_kg ? t("units.kg", { value: formatNumber(patient.weight_kg, i18n.language) }) : null,
  ].filter(Boolean);
  return (
    <li>
      <Link
        to={`/doctor/patients/${patient.id}`}
        className="row-link grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]"
      >
        <RecordNo id={patient.id} />
        <span className="min-w-0">
          <span className="block truncate font-semibold">{patient.full_name}</span>
          <span className="block truncate text-label text-ink-500 tabular-nums">{facts.join(" · ")}</span>
        </span>
        <span className="col-start-2 flex flex-wrap gap-2 sm:col-start-auto sm:justify-end">
          {!patient.consent_given_at && <span className="chip-finding">{t("patients.noConsent")}</span>}
          {patient.has_login && <span className="chip-quiet">{t("patients.hasLogin")}</span>}
        </span>
      </Link>
    </li>
  );
}
