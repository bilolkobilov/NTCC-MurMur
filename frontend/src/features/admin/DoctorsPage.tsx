import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";

import { adminApi, type Doctor } from "../../api/admin";
import { EmptyState, ErrorState, SkeletonRows } from "../../components/ui/States";
import { formatNumber, formatRelative } from "../../lib/format";
import {
  Avatar,
  Button,
  ButtonLink,
  SearchField,
  SelectField,
  type Status,
  StatusChip,
  SummaryTile,
  Tabs,
  TitleToolbar,
} from "../../redesign/components";
import { initials } from "../doctor/patients/PatientRegistry";

const STATUSES = ["all", "active", "invited", "suspended"] as const;
type StatusFilter = (typeof STATUSES)[number];
const CHIP: Record<Doctor["status"], Status> = { active: "normal", invited: "pending", suspended: "critical" };

/**
 * Doctors (design "Doctors: list and profile page"): summary, filters and the directory. Search, clinic and the
 * status tab live in the URL, so reload and Back keep them. A row opens the doctor's profile, where the admin
 * edits, blocks or resets the password.
 */
export function DoctorsPage() {
  const { t, i18n } = useTranslation();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const clinic = params.get("clinic") ?? "all";
  const status = STATUSES.find((s) => s === params.get("status")) ?? "all";
  const doctors = useQuery({ queryKey: ["admin", "doctors"], queryFn: adminApi.doctors, refetchInterval: 30_000 });

  const change = (next: Partial<{ q: string; clinic: string; status: StatusFilter }>) => {
    const merged = { q, clinic, status, ...next };
    setParams(
      {
        ...(merged.q ? { q: merged.q } : {}),
        ...(merged.clinic !== "all" ? { clinic: merged.clinic } : {}),
        ...(merged.status !== "all" ? { status: merged.status } : {}),
      },
      { replace: true },
    );
  };

  const all = doctors.data ?? [];
  const clinics = [...new Set(all.map((d) => d.clinic).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b));
  const needle = q.trim().toLowerCase();
  const matches = (d: Doctor, withStatus: boolean) =>
    (!withStatus || status === "all" || d.status === status) &&
    (clinic === "all" || d.clinic === clinic) &&
    (!needle || d.full_name.toLowerCase().includes(needle) || d.username.toLowerCase().includes(needle));
  const rows = all.filter((d) => matches(d, true));
  const count = (s: Doctor["status"]) => all.filter((d) => d.status === s).length;
  const n = (value: number) => formatNumber(value, i18n.language);

  return (
    <div className="flex flex-col gap-6">
      <TitleToolbar
        crumbsLabel={t("doctors.crumbs")}
        crumbs={[{ label: t("doctors.crumbAdmin") }, { label: t("doctors.title") }]}
        title={t("doctors.title")}
        description={t("doctors.listBody")}
        actions={
          <ButtonLink to="/admin/doctors/new" variant="primary" icon="plus">
            {t("doctors.add")}
          </ButtonLink>
        }
      />

      <div role="search" className="rd-searchbar">
        <SearchField
          className="flex-1 basis-64"
          label={t("doctors.searchLabel")}
          placeholder={t("doctors.searchLabel")}
          autoComplete="off"
          spellCheck={false}
          value={q}
          onChange={(e) => change({ q: e.target.value })}
        />
        <SelectField
          className="w-full sm:w-[220px] sm:shrink-0"
          label={t("doctors.clinic")}
          value={clinic}
          onChange={(e) => change({ clinic: e.target.value })}
          options={[
            { value: "all", label: t("doctors.allClinics", { count: clinics.length }) },
            ...clinics.map((c) => ({ value: c, label: c })),
          ]}
        />
      </div>

      <section aria-label={t("doctors.title")} className="rd-panel">
        {doctors.data && (
          <div role="group" aria-label={t("doctors.summaryLabel")} className="rd-tiles">
            <SummaryTile icon="users" value={n(all.length)} label={t("doctors.title")} />
            <SummaryTile icon="checkCircle" tone="normal" value={n(count("active"))} label={t("profile.status.active")} />
            <SummaryTile icon="clock" tone="pending" value={n(count("invited"))} label={t("profile.status.invited")} />
            <SummaryTile icon="ban" tone="abnormal" value={n(count("suspended"))} label={t("profile.status.suspended")} />
          </div>
        )}

        <div className="rd-panel__tabs">
          <Tabs
            label={t("doctors.tabsLabel")}
            value={status}
            onChange={(value) => change({ status: value })}
            options={[
              { value: "all", label: t("doctors.tabAll") },
              { value: "active", label: t("profile.status.active") },
              { value: "invited", label: t("profile.status.invited") },
              { value: "suspended", label: t("profile.status.suspended") },
            ]}
          />
        </div>

        {doctors.isPending && <SkeletonRows rows={5} label={t("common.loading")} />}
        {doctors.isError && !doctors.data && <ErrorState error={doctors.error} onRetry={() => void doctors.refetch()} />}
        {doctors.data && all.length === 0 && (
          <EmptyState
            title={t("doctors.emptyTitle")}
            body={t("doctors.emptyBody")}
            action={
              <ButtonLink to="/admin/doctors/new" variant="primary">
                {t("doctors.add")}
              </ButtonLink>
            }
          />
        )}
        {all.length > 0 && rows.length === 0 && (
          <EmptyState
            title={t("doctors.noMatchTitle")}
            body={t("doctors.noMatchBody")}
            action={<Button onClick={() => setParams({}, { replace: true })}>{t("doctors.clearFilters")}</Button>}
          />
        )}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="rd-table rd-table--stack" aria-label={t("doctors.tableLabel")}>
              <thead>
                <tr>
                  <th scope="col">{t("doctors.colDoctor")}</th>
                  <th scope="col">{t("doctors.colClinic")}</th>
                  <th scope="col">{t("doctors.colPatients")}</th>
                  <th scope="col">{t("doctors.colLastActive")}</th>
                  <th scope="col">{t("doctors.colStatus")}</th>
                  <th scope="col" className="rd-table__end">
                    <span className="rd-sr">{t("registry.colOpen")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((doctor) => (
                  <tr key={doctor.id}>
                    <td>
                      <div className="rd-table__who">
                        <Avatar soft initials={initials(doctor.full_name)} />
                        <div className="rd-table__cell">
                          <span className="rd-label truncate">{doctor.full_name}</span>
                          <span translate="no" className="rd-sm">
                            {doctor.username}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td data-label={t("doctors.colClinic")}>
                      {doctor.clinic ?? <span className="rd-sm italic">{t("doctors.noClinic")}</span>}
                    </td>
                    <td className="rd-table__ink tabular-nums" data-label={t("doctors.colPatients")}>
                      {n(doctor.patient_count)}
                    </td>
                    <td data-label={t("doctors.colLastActive")}>
                      {doctor.last_login_at ? formatRelative(doctor.last_login_at, i18n.language) : t("profile.neverSignedIn")}
                    </td>
                    <td data-label={t("doctors.colStatus")}>
                      <StatusChip status={CHIP[doctor.status]} label={t(`profile.status.${doctor.status}`)} />
                    </td>
                    <td className="rd-table__end">
                      <ButtonLink
                        to={`/admin/doctors/${doctor.id}`}
                        variant="ghost"
                        aria-label={t("doctors.openProfile", { name: doctor.full_name })}
                      >
                        {t("registry.open")}
                      </ButtonLink>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {doctors.data && all.length > 0 && (
          <div role="status" className="rd-sm border-t border-[var(--c-border)] px-5 py-3">
            {t("doctors.showing", { shown: rows.length, total: all.length })}
          </div>
        )}
      </section>
    </div>
  );
}
