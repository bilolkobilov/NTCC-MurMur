import { clsx } from "clsx";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import type { ActivityEntry, DoctorPatientRow, DoctorProfile } from "../../api/admin";
import type { PatientRegistryRow, Sex } from "../../api/doctor";
import { OnlineBadge } from "../../components/device/OnlineBadge";
import { ageFromBirthYear, formatDate, formatDateTime, formatNumber, formatRelative } from "../../lib/format";
import { Avatar, ButtonLink, Card, StatusChip, Tabs } from "../../redesign/components";
import { Icon } from "../../redesign/Icon";
import { initials, ResultChip } from "../doctor/patients/PatientRegistry";

type Viewer = "admin" | "doctor";
type Tab = "overview" | "patients" | "activity";

/** Who is looking decides the patient table: a doctor sees result chips and opens records, the admin sees neither. */
export type ProfilePatients = { kind: "own"; rows: PatientRegistryRow[] } | { kind: "admin"; rows: DoctorPatientRow[] };

const STATUS_CHIP = { active: "normal", invited: "pending", suspended: "critical" } as const;

/**
 * One profile page for two viewers (design "Doctors: list and profile page"). The doctor sees their own page and
 * cannot change the clinic; the admin sees the same page with the admin's buttons (`actions`, `onEditClinic`).
 * Recordings, AI results and notes never reach this component.
 */
export function DoctorProfileView({
  viewer,
  profile,
  patients,
  activity,
  actions,
  onEditClinic,
  onResetPassword,
}: {
  viewer: Viewer;
  profile: DoctorProfile;
  patients: ProfilePatients | undefined;
  activity: ActivityEntry[] | undefined;
  actions: ReactNode;
  onEditClinic?: () => void;
  onResetPassword?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<Tab>("overview");
  const n = (value: number) => formatNumber(value, i18n.language);
  const w = profile.workload;
  const isAdmin = viewer === "admin";

  return (
    <div className="flex flex-col gap-5">
      <nav aria-label={t("profile.crumbs")}>
        <ol className="rd-crumbs">
          <li>{isAdmin ? t("profile.crumbAdmin") : t("profile.crumbDoctor")}</li>
          <li aria-hidden="true">
            <Icon name="chevronRight" size="sm" />
          </li>
          {isAdmin && (
            <>
              <li>
                <Link to="/admin/doctors">{t("nav.doctors")}</Link>
              </li>
              <li aria-hidden="true">
                <Icon name="chevronRight" size="sm" />
              </li>
            </>
          )}
          <li aria-current="page">{isAdmin ? profile.full_name : t("nav.myProfile")}</li>
        </ol>
      </nav>

      {!isAdmin && (
        <p
          role="note"
          className="flex items-start gap-3 rounded-[8px] bg-[var(--c-primary-tint)] px-4 py-3 text-[13px] leading-[18px] font-medium text-[var(--c-primary-ink)]"
        >
          <Icon name="help" />
          {t("profile.ownNote")}
        </p>
      )}

      <section aria-label={t("profile.summary")} className="rd-card">
        <div className="rd-ident">
          <span className="rd-avatar rd-avatar--soft rd-avatar--xl" aria-hidden="true">
            {initials(profile.full_name)}
          </span>
          <div className="rd-ident__body">
            <div className="rd-ident__row">
              <h1 className="rd-h1">{profile.full_name}</h1>
              <StatusChip status={STATUS_CHIP[profile.status]} label={t(`profile.status.${profile.status}`)} />
            </div>
            <div className="rd-ident__facts">
              <span className="rd-body inline-flex items-center gap-1">
                <Icon name="building" size="sm" />
                {t("profile.clinic")}{" "}
                <strong className={clsx("text-[var(--c-ink)]", !profile.clinic && "font-normal italic")}>
                  {profile.clinic ?? t("doctors.noClinic")}
                </strong>
              </span>
              <span className="rd-body" translate="no">
                {profile.username}
              </span>
              <span className="rd-body">{t("profile.joined", { date: formatDate(profile.created_at, i18n.language) })}</span>
            </div>
          </div>
          <div className="rd-ident__actions">{actions}</div>
        </div>
        <div className="border-t border-[var(--c-border)] px-4">
          <Tabs
            label={t("profile.sections")}
            value={tab}
            onChange={setTab}
            options={[
              { value: "overview", label: t("profile.tabOverview") },
              { value: "patients", label: t("profile.tabPatients"), count: profile.patient_count },
              { value: "activity", label: t("profile.tabActivity") },
            ]}
          />
        </div>
      </section>

      <div className="rd-profile">
        <div className="rd-profile__main">
          {tab === "overview" && (
            <section aria-label={t("profile.workload")} className="rd-stats">
              <Stat label={t("profile.patientsAssigned")} value={n(w.patients)} note={t("profile.seenToday", { count: w.seen_today })} />
              <Stat label={t("profile.recordings30")} value={n(w.recordings_30d)} note={t("profile.acrossDevices", { count: w.devices_30d })} />
              <Stat label={t("profile.needsReview")} value={n(w.needs_review)} note={t("profile.waitingForDoctor")} />
              <Stat
                label={t("profile.medianReview")}
                value={w.median_review_minutes === null ? "—" : n(w.median_review_minutes)}
                unit={w.median_review_minutes === null ? undefined : t("profile.minutes")}
                note={t("profile.last30")}
              />
            </section>
          )}

          {tab !== "activity" && (
            <PatientsCard patients={patients} total={profile.patient_count} full={tab === "patients"} onViewAll={() => setTab("patients")} />
          )}
          {tab !== "patients" && <ActivityCard entries={activity} full={tab === "activity"} onViewAll={() => setTab("activity")} />}
        </div>

        <div className="rd-profile__rail">
          <Card
            title={t("profile.clinicCard")}
            className="rd-card--flush"
            meta={
              isAdmin ? (
                <button type="button" className="rd-linkbtn" onClick={onEditClinic}>
                  {t("profile.edit")}
                </button>
              ) : (
                <span className="rd-chip rd-chip--plain">
                  <Icon name="lock" />
                  {t("profile.setByAdmin")}
                </span>
              )
            }
          >
            <dl className="rd-kv">
              <dt>{t("profile.clinic")}</dt>
              <dd>{profile.clinic ?? <span className="font-normal italic">{t("doctors.noClinic")}</span>}</dd>
              <dt>{t("profile.access")}</dt>
              <dd>{t("profile.accessValue")}</dd>
            </dl>
          </Card>

          <Card title={t("profile.devicesCard")} className="rd-card--flush">
            {profile.devices.length === 0 ? (
              <p className="rd-body p-5">{t("profile.noDevices")}</p>
            ) : (
              <ul className="rd-list">
                {profile.devices.slice(0, 5).map((device) => (
                  <li key={device.id}>
                    <div className="rd-table__cell">
                      <span className="rd-label" translate="no">
                        {device.serial}
                      </span>
                      <span className="rd-sm">{device.name}</span>
                    </div>
                    <div className="flex flex-col items-end gap-0.5">
                      <OnlineBadge online={device.online} />
                      {device.last_seen_at && <span className="rd-sm">{formatRelative(device.last_seen_at, i18n.language)}</span>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={t("profile.securityCard")} className="rd-card--flush">
            <dl className="rd-kv">
              <dt>{t("profile.lastSignIn")}</dt>
              <dd>{profile.last_login_at ? formatDateTime(profile.last_login_at, i18n.language) : t("profile.neverSignedIn")}</dd>
              <dt>{t("profile.passwordChanged")}</dt>
              <dd>{profile.password_changed_at ? formatDate(profile.password_changed_at, i18n.language) : "—"}</dd>
              <dt>{t("profile.accountCreated")}</dt>
              <dd>{formatDate(profile.created_at, i18n.language)}</dd>
            </dl>
            <div className="flex flex-col gap-2 px-5 pb-5">
              {isAdmin ? (
                <button type="button" className="rd-btn rd-btn--secondary rd-btn--block" onClick={onResetPassword}>
                  {t("doctors.resetPassword")}
                </button>
              ) : (
                <ButtonLink to="/change-password" variant="secondary" className="rd-btn--block">
                  {t("nav.changePassword")}
                </ButtonLink>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, unit, note }: { label: string; value: string; unit?: string; note: string }) {
  return (
    <div className="rd-stat">
      <span className="rd-sm font-medium">{label}</span>
      <span className="rd-stat__value">
        {value}
        {unit && <span className="rd-sm ml-1">{unit}</span>}
      </span>
      <span className="rd-sm">{note}</span>
    </div>
  );
}

function PatientsCard({ patients, total, full, onViewAll }: { patients: ProfilePatients | undefined; total: number; full: boolean; onViewAll: () => void }) {
  const { t } = useTranslation();
  const count = patients?.rows.length ?? 0;
  const shownCount = full ? count : Math.min(count, 5);
  return (
    <Card
      title={full ? t("profile.allPatients") : t("profile.recentPatients")}
      className="rd-card--flush"
      meta={
        full ? (
          <span className="rd-sm">{t("profile.shownOf", { shown: shownCount, total })}</span>
        ) : (
          <button type="button" className="rd-linkbtn" onClick={onViewAll}>
            {t("profile.viewAll", { count: total })}
          </button>
        )
      }
    >
      {patients && count === 0 && <p className="rd-body p-5">{t("profile.noPatients")}</p>}
      {patients && count > 0 && (
        <div className="overflow-x-auto">
          <table className="rd-table" aria-label={t("profile.patientsTable")}>
            <thead>
              <tr>
                <th scope="col">{t("registry.colPatient")}</th>
                <th scope="col">{t("registry.colAgeSex")}</th>
                <th scope="col">{t("registry.colLastRecording")}</th>
                {patients.kind === "own" && <th scope="col">{t("registry.colStatus")}</th>}
                {patients.kind === "own" && (
                  <th scope="col" className="rd-table__end">
                    <span className="rd-sr">{t("registry.colOpen")}</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {patients.kind === "own"
                ? patients.rows.slice(0, shownCount).map((p) => (
                    <tr key={p.id}>
                      <PatientCells name={p.full_name} birthYear={p.birth_year} sex={p.sex} at={p.last_exam?.created_at ?? null} />
                      <td>
                        <ResultChip patient={p} />
                      </td>
                      <td className="rd-table__end">
                        <ButtonLink to={`/doctor/patients/${p.id}`} variant="ghost" aria-label={t("registry.openRecord", { name: p.full_name })}>
                          {t("registry.open")}
                        </ButtonLink>
                      </td>
                    </tr>
                  ))
                : patients.rows.slice(0, shownCount).map((p) => (
                    <tr key={p.id}>
                      <PatientCells name={p.full_name} birthYear={p.birth_year} sex={p.sex} at={p.last_exam_at} />
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function PatientCells({ name, birthYear, sex, at }: { name: string; birthYear: number; sex: Sex; at: string | null }) {
  const { t, i18n } = useTranslation();
  return (
    <>
      <td>
        <div className="rd-table__who">
          <Avatar soft initials={initials(name)} />
          <span className="rd-label truncate">{name}</span>
        </div>
      </td>
      <td className="tabular-nums">
        {ageFromBirthYear(birthYear)} · {t(`registry.sexShort.${sex}`)}
      </td>
      <td>{at ? formatRelative(at, i18n.language) : <span className="rd-sm">{t("registry.noRecording")}</span>}</td>
    </>
  );
}

function ActivityCard({ entries, full, onViewAll }: { entries: ActivityEntry[] | undefined; full: boolean; onViewAll: () => void }) {
  const { t, i18n } = useTranslation();
  const shown = full ? (entries ?? []) : (entries ?? []).slice(0, 4);
  return (
    <Card
      title={full ? t("profile.allActivity") : t("profile.recentActivity")}
      className="rd-card--flush"
      meta={
        full ? (
          <span className="rd-sm">{t("profile.last30")}</span>
        ) : (
          <button type="button" className="rd-linkbtn" onClick={onViewAll}>
            {t("profile.viewAllActivity")}
          </button>
        )
      }
    >
      {entries && shown.length === 0 && <p className="rd-body p-5">{t("profile.noActivity")}</p>}
      <ol className="m-0 list-none p-0 py-2">
        {shown.map((entry, index) => (
          <li key={entry.id} className="rd-tl">
            <div className="rd-tl__rail">
              <span className="rd-tl__dot" />
              {index < shown.length - 1 && <span className="rd-tl__line" />}
            </div>
            <div className="rd-table__cell">
              <span className="rd-label">{t(`audit.actions.${entry.action.replaceAll(".", "_")}`, { defaultValue: entry.action })}</span>
              <span className="rd-sm">{formatDateTime(entry.created_at, i18n.language)}</span>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
