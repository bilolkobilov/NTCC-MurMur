import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";

import {
  doctorApi,
  type PatientRegistryRow,
  type PatientSort,
  type PatientStatusFilter,
  PAGE_SIZE,
} from "../../../api/doctor";
import { Alert } from "../../../components/ui/Alert";
import { EmptyState, ErrorState, SkeletonRows } from "../../../components/ui/States";
import { ageFromBirthYear, formatRelative, initials } from "../../../lib/format";
import {
  Avatar,
  Button,
  ButtonLink,
  SearchField,
  SelectField,
  StatusChip,
  SummaryTile,
  Tabs,
  TitleToolbar,
  type Status,
} from "../../../redesign/components";
import { PointLabel, useOneTimeState } from "../shared";

const SORTS: PatientSort[] = ["recent", "name", "priority"];
const STATUSES: PatientStatusFilter[] = ["all", "needs_review", "pending"];

export { initials };

/**
 * The doctor's main page: the patient registry (design frame #0). Search, sort and the status tab live in the URL so
 * reload and Back keep them. The counts come from their own endpoint, because the list is paged. Both poll, so a
 * finished analysis shows up without a reload. "Show more" loads the next 50.
 */
export function PatientRegistry() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const urlQuery = params.get("q") ?? "";
  const sort = SORTS.find((s) => s === params.get("sort")) ?? "recent";
  const status = STATUSES.find((s) => s === params.get("status")) ?? "all";
  const [text, setText] = useState(urlQuery);

  const change = (next: Partial<{ q: string; sort: PatientSort; status: PatientStatusFilter }>) => {
    const merged = { q: urlQuery, sort, status, ...next };
    setParams(
      {
        ...(merged.q ? { q: merged.q } : {}),
        ...(merged.sort !== "recent" ? { sort: merged.sort } : {}),
        ...(merged.status !== "all" ? { status: merged.status } : {}),
      },
      { replace: true },
    );
  };

  // Typing updates the URL after a short pause (one request per pause, not per keystroke).
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (text.trim() !== urlQuery) change({ q: text.trim() });
    }, 250);
    return () => window.clearTimeout(timer);
    // `change` is rebuilt every render; only the typed text and the URL value matter here
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, urlQuery]);

  const patients = useInfiniteQuery({
    queryKey: ["patients", { q: urlQuery, sort, status }],
    queryFn: ({ pageParam }) => doctorApi.listPatients({ q: urlQuery, sort, status }, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, all) => (last.length === PAGE_SIZE ? all.length * PAGE_SIZE : undefined),
    refetchInterval: 15_000,
  });
  const summary = useQuery({
    queryKey: ["patients", "summary"],
    queryFn: doctorApi.patientSummary,
    refetchInterval: 15_000,
  });
  const rows = patients.data?.pages.flat() ?? [];
  const deleted = useOneTimeState<string>("deleted");
  const numbers = summary.data;

  return (
    <div className="flex flex-col gap-6">
      <TitleToolbar
        crumbsLabel={t("registry.crumbsLabel")}
        crumbs={[{ label: t("registry.crumbRoot") }, { label: t("registry.title") }]}
        title={t("registry.title")}
        actions={
          <ButtonLink to="/doctor/patients/new" variant="primary" icon="plus">
            {t("registry.newPatient")}
          </ButtonLink>
        }
      />
      <div className="flex flex-col gap-4">
      {deleted && <Alert tone="clear">{t("patients.deleted", { name: deleted })}</Alert>}

      <div role="search" className="rd-searchbar">
        <SearchField
          className="flex-1 basis-64"
          label={t("registry.searchLabel")}
          placeholder={t("registry.searchLabel")}
          name="q"
          autoComplete="off"
          spellCheck={false}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <SelectField
          className="w-full sm:w-[180px] sm:shrink-0"
          label={t("registry.sortLabel")}
          value={sort}
          onChange={(e) => change({ sort: e.target.value as PatientSort })}
          options={SORTS.map((value) => ({ value, label: t(`registry.sort.${value}`) }))}
        />
      </div>

      <section aria-label={t("registry.title")} className="rd-panel">
        {numbers && (
          <div role="group" aria-label={t("registry.summaryLabel")} className="rd-tiles">
            <SummaryTile icon="users" value={numbers.assigned_today} label={t("registry.assignedToday")} />
            <SummaryTile icon="checkCircle" tone="normal" value={numbers.normal} label={t("registry.normal")} />
            <SummaryTile icon="alertTriangle" tone="abnormal" value={numbers.needs_review} label={t("registry.needsReview")} />
            <SummaryTile icon="clock" tone="pending" value={numbers.pending} label={t("registry.pending")} />
          </div>
        )}

        <div className="rd-panel__tabs">
          <Tabs
            label={t("registry.tabsLabel")}
            value={status}
            onChange={(value) => change({ status: value })}
            options={[
              { value: "all", label: t("registry.tabAll") },
              { value: "needs_review", label: t("registry.needsReview") },
              { value: "pending", label: t("registry.pending") },
            ]}
          />
        </div>

        {patients.isPending && <SkeletonRows rows={6} label={t("common.loading")} />}
        {patients.isError && rows.length === 0 && <ErrorState error={patients.error} onRetry={() => void patients.refetch()} />}
        {patients.isSuccess && rows.length === 0 && !urlQuery && status === "all" && (
          <EmptyState
            title={t("patients.emptyTitle")}
            body={t("patients.emptyBody")}
            action={
              <ButtonLink to="/doctor/patients/new" variant="primary">
                {t("registry.newPatient")}
              </ButtonLink>
            }
          />
        )}
        {patients.isSuccess && rows.length === 0 && (urlQuery || status !== "all") && (
          <EmptyState
            title={urlQuery ? t("patients.noMatchTitle", { query: urlQuery }) : t("registry.noneInTab")}
            body={t("patients.noMatchBody")}
            action={
              <Button
                onClick={() => {
                  setText("");
                  change({ q: "", status: "all" });
                }}
              >
                {t("patients.clearSearch")}
              </Button>
            }
          />
        )}
        {rows.length > 0 && (
          <table className="rd-table rd-table--stack" aria-label={t("registry.tableLabel")}>
            <thead>
              <tr>
                <th scope="col">{t("registry.colPatient")}</th>
                <th scope="col">{t("registry.colAgeSex")}</th>
                <th scope="col">{t("registry.colClinic")}</th>
                <th scope="col">{t("registry.colLastRecording")}</th>
                <th scope="col">{t("registry.colStatus")}</th>
                <th scope="col" className="rd-table__end">
                  <span className="rd-sr">{t("registry.colOpen")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((patient) => (
                <RegistryRow key={patient.id} patient={patient} />
              ))}
            </tbody>
          </table>
        )}
        {patients.hasNextPage && (
          <div className="border-t border-line p-3 text-center">
            <Button onClick={() => void patients.fetchNextPage()} busy={patients.isFetchingNextPage} busyText={t("common.loading")}>
              {t("patients.showMore")}
            </Button>
          </div>
        )}
      </section>
      </div>
    </div>
  );
}

function RegistryRow({ patient }: { patient: PatientRegistryRow }) {
  const { t, i18n } = useTranslation();
  const exam = patient.last_exam;
  return (
    <tr>
      <td>
        <div className="rd-table__who">
          <Avatar soft initials={initials(patient.full_name)} />
          <div className="rd-table__cell">
            <span className="rd-label truncate">{patient.full_name}</span>
            <span translate="no" className="rd-sm">
              № {String(patient.id).padStart(3, "0")}
            </span>
          </div>
        </div>
      </td>
      <td className="tabular-nums" data-label={t("registry.colAgeSex")}>
        {ageFromBirthYear(patient.birth_year)} · {t(`registry.sexShort.${patient.sex}`)}
      </td>
      <td data-label={t("registry.colClinic")}>
        <div className="rd-table__cell">
          <span className="rd-label">{patient.clinic ?? "—"}</span>
          <span className="rd-sm">
            {exam && (exam.status === "analyzed" || exam.status === "reviewed")
              ? t("registry.analyzedAt", { clinic: exam.clinic ?? "—", device: exam.device_name ?? "—" })
              : t("registry.notAnalyzed")}
          </span>
        </div>
      </td>
      <td data-label={t("registry.colLastRecording")}>
        {exam ? (
          <div className="rd-table__cell">
            <span className="rd-table__ink">
              {exam.status === "uploaded" ? t("registry.analysisInProgress") : <PointLabel point={exam.point} />}
            </span>
            <span className="rd-sm">{formatRelative(exam.created_at, i18n.language)}</span>
          </div>
        ) : (
          <span className="rd-sm">{t("registry.noRecording")}</span>
        )}
      </td>
      <td data-label={t("registry.colStatus")}>
        <ResultChip patient={patient} />
      </td>
      <td className="rd-table__end">
        <ButtonLink
          to={`/doctor/patients/${patient.id}`}
          variant="ghost"
          aria-label={t("registry.openRecord", { name: patient.full_name })}
        >
          {t("registry.open")}
        </ButtonLink>
      </td>
    </tr>
  );
}

/** The word comes from the backend's `result_status`. Borderline / critical never appear: the model gives yes / no only. */
export function ResultChip({ patient }: { patient: Pick<PatientRegistryRow, "result_status" | "needs_review"> }) {
  const { t } = useTranslation();
  const { result_status: result, needs_review: needsReview } = patient;
  const [status, word]: [Status, string] =
    result === "pending" && needsReview
      ? ["pending", t("registry.chip.awaitingReview")]
      : result === "failed"
        ? ["borderline", t("registry.chip.failed")] // amber: not a clinical finding, the recording must be redone
        : result === "reviewed"
          ? ["pending", t("registry.chip.reviewed")]
          : [result, t(`registry.chip.${result}`)];
  return <StatusChip status={status} label={word} />;
}
