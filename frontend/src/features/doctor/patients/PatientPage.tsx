import * as Menu from "@radix-ui/react-dropdown-menu";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router";

import { errorMessage } from "../../../api/client";
import {
  type DoctorDevice,
  doctorApi,
  type ExamDetail,
  type OneTimeLogin,
  type Patient,
  type PatientExamRow,
} from "../../../api/doctor";
import { Alert } from "../../../components/ui/Alert";
import { Button as PlainButton } from "../../../components/ui/Button";
import { Dialog } from "../../../components/ui/Dialog";
import { SecretDialog } from "../../../components/ui/SecretDialog";
import { EmptyState, ErrorState, SkeletonRows } from "../../../components/ui/States";
import { TextField } from "../../../components/ui/TextField";
import { ageFromBirthYear, formatDate, formatDateTime, formatNumber } from "../../../lib/format";
import { Breadcrumbs, ButtonLink, DAlert, DCard, StatusChip, Tabs } from "../../../redesign/components";
import { Icon } from "../../../redesign/Icon";
import { aiOutcome } from "../exam/aiOutcome";
import { PointLabel, useOneTimeState } from "../shared";
import { initials, ResultChip } from "./PatientRegistry";
import { VitalsCard } from "./VitalsCard";

type Tab = "overview" | "recordings";

/**
 * The patient's page (design "Patient profile"): a flag when the AI found something to review, the identity card with
 * the next action, then Overview (measurements, latest auscultation, recent history) or Recordings (all of them), with
 * the device, details, consent, login and deletion in the right column. Everything shown comes from the database or the
 * AI model's real answer; nothing is made up for the layout (no vitals, no murmur grade).
 */
export function PatientPage() {
  const id = Number(useParams().patientId);
  const { t, i18n } = useTranslation();
  const justSaved = useOneTimeState<boolean>("saved");
  const [tab, setTab] = useState<Tab>("overview");
  const [deleting, setDeleting] = useState(false);
  const patient = useQuery({ queryKey: ["patient", id], queryFn: () => doctorApi.getPatient(id) });
  const exams = useQuery({
    queryKey: ["patientExams", id],
    queryFn: () => doctorApi.patientExams(id),
    refetchInterval: 15_000, // a finished analysis shows up without a reload
  });
  const devices = useQuery({ queryKey: ["devices"], queryFn: doctorApi.myDevices });
  const rows = exams.data ?? [];
  const latest = rows[0];
  const lastAnalyzed = rows.find((e) => e.status === "analyzed" || e.status === "reviewed");
  const detail = useQuery({
    queryKey: ["exam", lastAnalyzed?.id],
    queryFn: () => doctorApi.getExam(lastAnalyzed!.id),
    enabled: !!lastAnalyzed,
  });

  // Keep showing data we already have if a background refresh fails (e.g. a hotspot hiccup).
  if (!patient.data) {
    if (patient.isError) return <ErrorState error={patient.error} onRetry={() => void patient.refetch()} />;
    return <SkeletonRows rows={4} label={t("common.loading")} />;
  }
  const p = patient.data;
  const flagged = latest && latest.result_status === "abnormal" && latest.needs_review ? latest : undefined;
  const device =
    devices.data?.find((d) => d.id === latest?.device_id) ?? (devices.data?.length === 1 ? devices.data[0] : undefined);

  return (
    <div className="flex flex-col gap-5">
      <Breadcrumbs
        label={t("registry.crumbsLabel")}
        items={[
          { label: t("registry.crumbRoot") },
          { label: t("registry.title"), href: "/doctor/patients" },
          { label: p.full_name },
        ]}
      />
      {justSaved && (
        <DAlert tone="ok" icon="checkCircle">
          {t("patient.saved")}
        </DAlert>
      )}

      {flagged && (
        <div className="rd-banner" role="alert">
          <Icon name="alertTriangle" size="lg" />
          <div className="rd-banner__text">
            <strong>{t("patient.flagTitle")}</strong>
            <span>
              {t("patient.flagBody", {
                point: flagged.point,
                when: formatDateTime(flagged.created_at, i18n.language),
              })}
            </span>
          </div>
          <ButtonLink to={`/doctor/exams/${flagged.id}`} variant="primary">
            {t("patient.reviewAnalysis")}
          </ButtonLink>
        </div>
      )}

      <section aria-label={t("patient.summaryLabel")} className="rd-dcard">
        <Identity patient={p} latest={latest} onDelete={() => setDeleting(true)} />
        <div className="px-4" style={{ borderTop: "1px solid var(--c-border)" }}>
          <Tabs
            label={t("patient.sectionsLabel")}
            value={tab}
            onChange={setTab}
            options={[
              { value: "overview", label: t("patient.tabOverview") },
              { value: "recordings", label: t("patient.tabRecordings"), count: rows.length },
            ]}
          />
        </div>
      </section>

      <div className="flex flex-wrap items-start gap-5">
        <div className="flex min-w-0 flex-col gap-5" style={{ flex: "2 1 620px" }}>
          {!p.consent_given_at && <ConsentPanel patient={p} />}
          {tab === "overview" && (
            <>
              <VitalsCard patient={p} />
              <LatestCard patient={p} exam={lastAnalyzed} detail={detail.data} loading={exams.isPending} />
              <HistoryCard
                patient={p}
                rows={rows.slice(0, 5)}
                total={rows.length}
                state={exams}
                onViewAll={() => setTab("recordings")}
              />
            </>
          )}
          {tab === "recordings" && <HistoryCard patient={p} rows={rows} total={rows.length} state={exams} />}
        </div>
        <div className="flex min-w-0 flex-col gap-5" style={{ flex: "1 1 340px" }}>
          <DeviceCard patient={p} device={device} />
          <DetailsCard patient={p} latest={lastAnalyzed} />
          {p.consent_given_at && <ConsentPanel patient={p} />}
          <LoginPanel patient={p} />
          <DeleteCard onOpen={() => setDeleting(true)} />
        </div>
      </div>

      <DeleteDialog patient={p} open={deleting} onOpenChange={setDeleting} />
    </div>
  );
}

/** Name, status, the record number (the patient id, shown in full) and the next action. The details live in the cards below. */
function Identity({
  patient,
  latest,
  onDelete,
}: {
  patient: Patient;
  latest: PatientExamRow | undefined;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <div className="flex flex-wrap items-center gap-5 p-5">
      <span className="rd-avatar rd-avatar--soft rd-avatar--xl" aria-hidden="true">
        {initials(patient.full_name)}
      </span>
      <div className="flex min-w-0 flex-col gap-3" style={{ flex: "1 1 320px" }}>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="rd-h1">{patient.full_name}</h1>
          {latest ? <ResultChip patient={latest} /> : <StatusChip status="pending" label={t("patientForm.noRecordings")} />}
        </div>
        <span className="rd-fact tabular-nums" translate="no">
          {t("patient.mrn")} № {String(patient.id).padStart(3, "0")}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {patient.consent_given_at && (
          <ButtonLink to={`/doctor/patients/${patient.id}/exam`} variant="primary" icon="mic">
            {t("patient.recordAuscultation")}
          </ButtonLink>
        )}
        <Menu.Root>
          <Menu.Trigger className="rd-icon-btn" aria-label={t("patient.moreActions")}>
            <Icon name="more" />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content align="end" sideOffset={6} className="rd-menu">
              <Menu.Item onSelect={() => navigate(`/doctor/patients/${patient.id}/edit`)} className="rd-menu-item">
                <Icon name="pencil" size="sm" />
                {t("patient.edit")}
              </Menu.Item>
              <Menu.Item onSelect={onDelete} className="rd-menu-item">
                <Icon name="ban" size="sm" />
                {t("patient.delete")}
              </Menu.Item>
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
      </div>
    </div>
  );
}

/** The AI's real answer for the last analyzed recording: murmur or not, and its probability. No grade, no heart rate. */
function LatestCard({
  patient,
  exam,
  detail,
  loading,
}: {
  patient: Patient;
  exam: PatientExamRow | undefined;
  detail: ExamDetail | undefined;
  loading: boolean;
}) {
  const { t, i18n } = useTranslation();
  const outcome = aiOutcome(detail?.ai_result ?? null);
  const probability =
    (outcome.kind === "murmur" || outcome.kind === "clear") && outcome.murmurProbability !== null
      ? Math.round(outcome.murmurProbability * 100)
      : null;
  return (
    <DCard
      id="h-latest"
      title={t("patient.latest")}
      icon="activity"
      meta={
        <span className="rd-chip rd-chip--ai">
          <Icon name="activity" />
          {t("patient.aiChip")}
        </span>
      }
    >
      {!exam ? (
        <EmptyState
          title={t("patient.noExamsTitle")}
          body={
            loading
              ? t("common.loading")
              : patient.consent_given_at
                ? t("patient.noExamsBody")
                : t("patient.noExamsNeedConsent")
          }
          action={
            patient.consent_given_at ? (
              <ButtonLink to={`/doctor/patients/${patient.id}/exam`} variant="primary" icon="mic">
                {t("patient.recordAuscultation")}
              </ButtonLink>
            ) : undefined
          }
        />
      ) : (
        <div className="flex flex-col gap-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <span className="rd-label">
              {t("patient.latestMeta", {
                point: `${exam.point} · ${t(`exam.point.${exam.point}`)}`,
                seconds: exam.duration_s === null ? "—" : Math.round(exam.duration_s),
                when: formatDateTime(exam.created_at, i18n.language),
              })}
            </span>
            <ResultChip patient={exam} />
          </div>
          <div className="rd-fgrid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
            <div className="flex flex-col gap-1">
              <span className="rd-cap">{t("patient.colFinding")}</span>
              <span className="rd-label">
                {detail ? t(`result.outcome.${outcome.kind}`, { label: outcome.kind === "other" ? outcome.label : "" }) : "—"}
              </span>
            </div>
            {probability !== null && (
              <div className="flex flex-col gap-1">
                <span className="rd-cap">{t("result.aiTitle")}</span>
                <span className="rd-label">{t("result.confidence", { percent: probability })}</span>
              </div>
            )}
          </div>
          <div>
            <ButtonLink to={`/doctor/exams/${exam.id}`} icon="play">
              {t("patient.openAnalysis")}
            </ButtonLink>
          </div>
        </div>
      )}
    </DCard>
  );
}

function findingWord(row: PatientExamRow, t: (key: string) => string): string {
  if (row.result_status === "failed") return t("registry.chip.failed");
  if (row.status === "waiting" || row.status === "recording" || row.status === "uploaded") {
    return t("registry.analysisInProgress");
  }
  if (row.ai_label === "murmur") return t("result.outcome.murmur");
  if (row.ai_label === "absent") return t("result.outcome.clear");
  return t("patient.findingNone");
}

/** One row per recording: when, where on the chest, length, what the AI found, where it was analyzed, status. */
function HistoryCard({
  patient,
  rows,
  total,
  state,
  onViewAll,
}: {
  patient: Patient;
  rows: PatientExamRow[];
  total: number;
  state: { isPending: boolean; isError: boolean; error: unknown; data: PatientExamRow[] | undefined; refetch: () => unknown };
  onViewAll?: () => void;
}) {
  const { t, i18n } = useTranslation();
  return (
    <DCard
      id="h-history"
      title={t("patient.history")}
      icon="mic"
      meta={
        onViewAll && total > rows.length ? (
          <button type="button" className="rd-linkbtn" onClick={onViewAll}>
            {t("patient.viewAll", { count: total })}
          </button>
        ) : undefined
      }
    >
      {state.isPending && <SkeletonRows rows={3} label={t("common.loading")} />}
      {state.isError && !state.data && <ErrorState error={state.error} onRetry={() => void state.refetch()} />}
      {state.data && rows.length === 0 && (
        <EmptyState
          title={t("patient.noExamsTitle")}
          body={patient.consent_given_at ? t("patient.noExamsBody") : t("patient.noExamsNeedConsent")}
        />
      )}
      {rows.length > 0 && (
        <div className="rd-scroll">
          <table className="rd-table" aria-label={t("patient.historyLabel")} style={{ minWidth: 820 }}>
            <thead>
              <tr>
                <th scope="col">{t("patient.colWhen")}</th>
                <th scope="col">{t("patient.colSite")}</th>
                <th scope="col">{t("patient.colLength")}</th>
                <th scope="col">{t("patient.colFinding")}</th>
                <th scope="col">{t("patient.colAnalyzedAt")}</th>
                <th scope="col">{t("patient.colStatus")}</th>
                <th scope="col" className="rd-table__end">
                  <span className="rd-sr">{t("patient.colOpen")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const when = formatDateTime(row.created_at, i18n.language);
                return (
                  <tr key={row.id}>
                    <td className="tabular-nums">{when}</td>
                    <td>
                      <PointLabel point={row.point} short />
                    </td>
                    <td className="tabular-nums">
                      {row.duration_s === null ? "—" : t("patient.seconds", { value: Math.round(row.duration_s) })}
                    </td>
                    <td>{findingWord(row, t)}</td>
                    <td>
                      <div className="rd-table__cell">
                        <span className="rd-table__ink">{row.clinic ?? "—"}</span>
                        <span className="rd-sm" translate="no">
                          {row.device_code ?? "—"}
                        </span>
                      </div>
                    </td>
                    <td>
                      <ResultChip patient={row} />
                    </td>
                    <td className="rd-table__end">
                      <ButtonLink
                        to={`/doctor/exams/${row.id}`}
                        variant="ghost"
                        aria-label={t("patient.openRecording", { site: row.point, when })}
                      >
                        {t("registry.open")}
                      </ButtonLink>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </DCard>
  );
}

/** The device of the latest recording (or the doctor's only device). Choosing another one happens when a recording starts. */
function DeviceCard({ patient, device }: { patient: Patient; device: DoctorDevice | undefined }) {
  const { t } = useTranslation();
  return (
    <DCard
      id="h-iot"
      title={t("patient.iot")}
      icon="stethoscope"
      meta={
        device && (
          <StatusChip
            status={device.online ? "normal" : "pending"}
            label={t(device.online ? "device.online" : "device.offline")}
          />
        )
      }
    >
      {device ? (
        <dl className="rd-kv">
          <dt>{t("patient.iotDeviceId")}</dt>
          <dd translate="no">{device.code}</dd>
          <dt>{t("patient.iotModel")}</dt>
          <dd>{device.model}</dd>
          <dt>{t("patient.iotClinic")}</dt>
          <dd>{device.clinic ?? "—"}</dd>
          <dt>{t("patient.iotLocation")}</dt>
          <dd>{device.location ?? "—"}</dd>
          <dt>{t("patient.iotBattery")}</dt>
          <dd>{device.battery_pct === null ? t("patient.noData") : `${device.battery_pct} %`}</dd>
        </dl>
      ) : (
        <p className="rd-body p-5">{t("patient.iotNone")}</p>
      )}
      {patient.consent_given_at && device && (
        <div className="px-5 pb-5">
          <ButtonLink to={`/doctor/patients/${patient.id}/exam`} icon="refresh" className="w-full">
            {t("patient.iotChoose")}
          </ButtonLink>
        </div>
      )}
    </DCard>
  );
}

function DetailsCard({ patient, latest }: { patient: Patient; latest: PatientExamRow | undefined }) {
  const { t, i18n } = useTranslation();
  const cm = patient.height_cm ? t("units.cm", { value: formatNumber(patient.height_cm, i18n.language) }) : "—";
  const kg = patient.weight_kg ? t("units.kg", { value: formatNumber(patient.weight_kg, i18n.language) }) : "—";
  return (
    <DCard
      id="h-details"
      title={t("patient.details")}
      icon="user"
      meta={
        <ButtonLink to={`/doctor/patients/${patient.id}/edit`} variant="ghost">
          {t("patient.edit")}
        </ButtonLink>
      }
    >
      <dl className="rd-kv">
        <dt>{t("patient.fullName")}</dt>
        <dd>{patient.full_name}</dd>
        <dt>{t("patient.yearOfBirth")}</dt>
        <dd className="tabular-nums">
          {patient.birth_year} ({t("patients.age", { count: ageFromBirthYear(patient.birth_year) })})
        </dd>
        <dt>{t("patientForm.sex")}</dt>
        <dd>{t(`sex.${patient.sex}`)}</dd>
        <dt>
          {t("patient.height")} · {t("patient.weight")}
        </dt>
        <dd className="tabular-nums">
          {cm} · {kg}
        </dd>
        <dt>{t("patient.registeredAt")}</dt>
        <dd>
          {patient.clinic ?? "—"}
          <br />
          <span className="rd-sm">{formatDate(patient.created_at, i18n.language)}</span>
        </dd>
        <dt>{t("patient.latestAnalysis")}</dt>
        <dd>
          {latest ? (
            <>
              {latest.clinic ?? "—"}
              <br />
              <span className="rd-sm">
                {formatDate(latest.created_at, i18n.language)}
                {latest.device_code ? ` · ${latest.device_code}` : ""}
              </span>
            </>
          ) : (
            t("patient.notAnalyzedYet")
          )}
        </dd>
      </dl>
    </DCard>
  );
}

function usePatientUpdate(patientId: number) {
  const queryClient = useQueryClient();
  return (saved: Patient) => {
    queryClient.setQueryData(["patient", patientId], saved);
    void queryClient.invalidateQueries({ queryKey: ["patients"] });
  };
}

function ConsentPanel({ patient }: { patient: Patient }) {
  const { t, i18n } = useTranslation();
  const [confirmed, setConfirmed] = useState(false);
  const [problem, setProblem] = useState(false);
  const update = usePatientUpdate(patient.id);
  const record = useMutation({ mutationFn: () => doctorApi.recordConsent(patient.id), onSuccess: update });

  if (patient.consent_given_at) {
    return (
      <DCard id="h-consent" title={t("patient.consent")} icon="shield">
        <p className="rd-body p-5">
          <span className="text-clear">✓ </span>
          {t("patient.consentRecorded", { date: formatDate(patient.consent_given_at, i18n.language) })}
        </p>
      </DCard>
    );
  }
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!confirmed) return setProblem(true);
    record.mutate();
  };
  const failure = record.isError ? errorMessage(record.error) : null;
  return (
    <section className="rounded-card border border-finding/30 bg-finding-bg p-5">
      <h2 className="text-title font-semibold text-finding">{t("patient.consentMissingTitle")}</h2>
      <p className="mt-1 text-ink-700">{t("patient.consentMissingBody")}</p>
      <form onSubmit={submit} noValidate className="mt-4 flex flex-col gap-3">
        {failure && <Alert tone="danger">{t(failure.key, failure.values ?? {})}</Alert>}
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => {
              setConfirmed(e.target.checked);
              setProblem(false);
            }}
            aria-describedby={problem ? "consent-problem" : undefined}
            className="mt-0.5 size-5 shrink-0 accent-[var(--color-ink-900)]"
          />
          <span>{t("patient.consentConfirm")}</span>
        </label>
        {problem && (
          <p id="consent-problem" className="text-caption font-medium text-danger">
            {t("patient.consentTickFirst")}
          </p>
        )}
        <div>
          <PlainButton type="submit" variant="primary" busy={record.isPending} busyText={t("common.saving")}>
            {t("patient.recordConsent")}
          </PlainButton>
        </div>
      </form>
    </section>
  );
}

/** A username suggestion from a Latin-script name: "Ali Valiyev" → "ali.valiyev". Cyrillic names get none. */
export function suggestUsername(fullName: string): string {
  const parts = fullName.toLowerCase().normalize("NFKD").replace(/[ʻʼ'‘’`]/g, "").split(/\s+/).filter(Boolean);
  const clean = parts.map((part) => part.replace(/[^a-z0-9]/g, "")).filter(Boolean);
  const name = clean.length > 1 ? `${clean[0]}.${clean[clean.length - 1]}` : (clean[0] ?? "");
  return name.length >= 3 ? name.slice(0, 64) : "";
}

function LoginPanel({ patient }: { patient: Patient }) {
  const { t } = useTranslation();
  const [username, setUsername] = useState(() => suggestUsername(patient.full_name));
  const [problem, setProblem] = useState<string>();
  const [secret, setSecret] = useState<(OneTimeLogin & { kind: "created" | "reset" }) | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const update = usePatientUpdate(patient.id);

  const create = useMutation({
    mutationFn: () => doctorApi.createLogin(patient.id, username.trim()),
    onSuccess: (login) => {
      setSecret({ ...login, kind: "created" });
      update({ ...patient, has_login: true });
    },
  });
  const reset = useMutation({
    mutationFn: () => doctorApi.resetPassword(patient.id),
    onSuccess: (login) => {
      setConfirmReset(false);
      setSecret({ ...login, kind: "reset" });
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (create.isPending) return;
    if (!/^[A-Za-z0-9._-]{3,64}$/.test(username.trim())) return setProblem(t("patient.usernameRule"));
    setProblem(undefined);
    create.mutate();
  };
  const failure = create.isError
    ? create.error && errorMessage(create.error).key === "errors.conflict"
      ? t("patient.usernameTaken")
      : t(errorMessage(create.error).key)
    : null;

  return (
    <DCard id="h-login" title={t("patient.login")} icon="lock">
      <div className="p-5">
        {patient.has_login ? (
          <>
            <p className="text-ink-700">{t("patient.loginExists")}</p>
            <PlainButton className="mt-3" onClick={() => setConfirmReset(true)}>
              {t("patient.resetPassword")}
            </PlainButton>
          </>
        ) : (
          <form onSubmit={submit} noValidate className="flex flex-col gap-3">
            <p className="text-ink-700">{t("patient.loginMissing")}</p>
            {failure && <Alert tone="danger">{failure}</Alert>}
            <TextField
              label={t("login.username")}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              translate="no"
              hint={t("patient.usernameRule")}
              error={problem}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <div>
              <PlainButton type="submit" busy={create.isPending} busyText={t("common.saving")}>
                {t("patient.createLogin")}
              </PlainButton>
            </div>
          </form>
        )}
      </div>

      <Dialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title={t("patient.resetTitle", { name: patient.full_name })}
        description={t("patient.resetBody")}
        footer={
          <>
            <PlainButton onClick={() => setConfirmReset(false)}>{t("common.cancel")}</PlainButton>
            <PlainButton variant="primary" busy={reset.isPending} busyText={t("common.saving")} onClick={() => reset.mutate()}>
              {t("patient.resetConfirm")}
            </PlainButton>
          </>
        }
      >
        {reset.isError && <Alert tone="danger">{t(errorMessage(reset.error).key)}</Alert>}
      </Dialog>

      <SecretDialog
        open={!!secret}
        title={secret?.kind === "reset" ? t("patient.secretResetTitle") : t("patient.secretCreatedTitle")}
        description={t("patient.secretBody", { name: patient.full_name })}
        secrets={
          secret
            ? [
                { label: t("login.username"), value: secret.username },
                { label: t("patient.oneTimePassword"), value: secret.temporary_password },
              ]
            : []
        }
        acknowledge={t("patient.secretDone")}
        onClose={() => setSecret(null)}
      />
    </DCard>
  );
}

function DeleteCard({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation();
  return (
    <section className="rounded-card border border-danger/25 p-4">
      <h2 className="text-label font-semibold tracking-wide text-danger uppercase">{t("patient.deleteSection")}</h2>
      <p className="mt-1 text-label text-ink-500">{t("patient.deleteHint")}</p>
      <PlainButton variant="danger" className="mt-3" onClick={onOpen}>
        {t("patient.delete")}
      </PlainButton>
    </section>
  );
}

function DeleteDialog({
  patient,
  open,
  onOpenChange,
}: {
  patient: Patient;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [typed, setTyped] = useState("");
  const exams = queryClient.getQueryData<unknown[]>(["patientExams", patient.id]);
  const matches = typed.trim().toLowerCase() === patient.full_name.trim().toLowerCase();

  const remove = useMutation({
    mutationFn: () => doctorApi.deletePatient(patient.id),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ["patient", patient.id] });
      queryClient.removeQueries({ queryKey: ["patientExams", patient.id] });
      void queryClient.invalidateQueries({ queryKey: ["patients"] });
      void queryClient.invalidateQueries({ queryKey: ["exams"] });
      navigate("/doctor/patients", { replace: true, state: { deleted: patient.full_name } });
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setTyped("");
      }}
      title={t("patient.deleteTitle", { name: patient.full_name })}
      description={t("patient.deleteBody", { count: exams?.length ?? 0 })}
      footer={
        <>
          <PlainButton onClick={() => onOpenChange(false)}>{t("patient.keep")}</PlainButton>
          <PlainButton
            variant="danger"
            disabled={!matches}
            busy={remove.isPending}
            busyText={t("common.deleting")}
            onClick={() => remove.mutate()}
          >
            {t("patient.delete")}
          </PlainButton>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {remove.isError && <Alert tone="danger">{t(errorMessage(remove.error).key)}</Alert>}
        <TextField
          label={t("patient.deleteTypeName", { name: patient.full_name })}
          autoComplete="off"
          spellCheck={false}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          hint={matches ? undefined : t("patient.deleteTypeHint")}
        />
      </div>
    </Dialog>
  );
}
