import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";

import { errorMessage } from "../../../api/client";
import { doctorApi, type OneTimeLogin, type Patient } from "../../../api/doctor";
import { StatusMark } from "../../../components/exam/StatusMark";
import { Alert } from "../../../components/ui/Alert";
import { Button, ButtonLink } from "../../../components/ui/Button";
import { Dialog } from "../../../components/ui/Dialog";
import { SecretDialog } from "../../../components/ui/SecretDialog";
import { EmptyState, ErrorState, PageHeader, Panel, SkeletonRows } from "../../../components/ui/States";
import { TextField } from "../../../components/ui/TextField";
import { ageFromBirthYear, formatDate, formatDateTime, formatNumber } from "../../../lib/format";
import { PointLabel, RecordNo, useOneTimeState } from "../shared";

export function PatientPage() {
  const id = Number(useParams().patientId);
  const { t } = useTranslation();
  const justSaved = useOneTimeState<boolean>("saved");
  const patient = useQuery({ queryKey: ["patient", id], queryFn: () => doctorApi.getPatient(id) });

  // Keep showing data we already have if a background refresh fails (e.g. a hotspot hiccup).
  if (!patient.data) {
    if (patient.isError) return <ErrorState error={patient.error} onRetry={() => void patient.refetch()} />;
    return <SkeletonRows rows={4} label={t("common.loading")} />;
  }
  const p = patient.data;

  return (
    <>
      <Link to="/doctor/patients" className="mb-3 inline-flex min-h-11 items-center text-label text-ink-500 hover:text-ink-900">
        ← {t("patients.title")}
      </Link>
      <PageHeader
        title={p.full_name}
        meta={
          <span className="flex flex-wrap items-baseline gap-x-3">
            <RecordNo id={p.id} />
            <PatientFacts patient={p} />
          </span>
        }
        actions={
          p.consent_given_at ? (
            <ButtonLink to={`/doctor/patients/${p.id}/exam`} variant="primary">
              {t("patient.startExam")}
            </ButtonLink>
          ) : undefined
        }
      />
      {justSaved && (
        <div className="mb-6">
          <Alert tone="clear">{t("patient.saved")}</Alert>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-6">
          {!p.consent_given_at && <ConsentPanel patient={p} />}
          <ExamHistory patient={p} />
        </div>
        <div className="flex flex-col gap-6">
          {p.consent_given_at && <ConsentPanel patient={p} />}
          <LoginPanel patient={p} />
          <DetailsPanel patient={p} />
          <DeletePanel patient={p} />
        </div>
      </div>
    </>
  );
}

function PatientFacts({ patient }: { patient: Patient }) {
  const { t, i18n } = useTranslation();
  const facts = [
    t("patients.bornIn", { year: patient.birth_year, count: ageFromBirthYear(patient.birth_year) }),
    t(`sex.${patient.sex}`),
    patient.height_cm ? t("units.cm", { value: formatNumber(patient.height_cm, i18n.language) }) : null,
    patient.weight_kg ? t("units.kg", { value: formatNumber(patient.weight_kg, i18n.language) }) : null,
  ].filter(Boolean);
  return <span className="tabular-nums">{facts.join(" · ")}</span>;
}

function ExamHistory({ patient }: { patient: Patient }) {
  const { t, i18n } = useTranslation();
  const exams = useQuery({ queryKey: ["patientExams", patient.id], queryFn: () => doctorApi.patientExams(patient.id) });
  return (
    <Panel title={t("patient.exams")}>
      {exams.isPending && <SkeletonRows rows={3} label={t("common.loading")} />}
      {exams.isError && !exams.data && <ErrorState error={exams.error} onRetry={() => void exams.refetch()} />}
      {exams.data && exams.data.length === 0 && (
        <EmptyState
          title={t("patient.noExamsTitle")}
          body={patient.consent_given_at ? t("patient.noExamsBody") : t("patient.noExamsNeedConsent")}
          action={
            patient.consent_given_at ? (
              <ButtonLink to={`/doctor/patients/${patient.id}/exam`} variant="primary">
                {t("patient.startExam")}
              </ButtonLink>
            ) : undefined
          }
        />
      )}
      {exams.data && exams.data.length > 0 && (
        <ul className="divide-y divide-line">
          {exams.data.map((exam) => (
            <li key={exam.id}>
              <Link
                to={`/doctor/exams/${exam.id}`}
                className="row-link grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[180px_minmax(0,1fr)_auto]"
              >
                <StatusMark status={exam.status} />
                <PointLabel point={exam.point} />
                <span className="text-caption text-ink-500 tabular-nums sm:text-right">
                  {formatDateTime(exam.created_at, i18n.language)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
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
      <Panel title={t("patient.consent")}>
        <p className="px-4 py-4">
          <span className="text-clear">✓ </span>
          {t("patient.consentRecorded", { date: formatDate(patient.consent_given_at, i18n.language) })}
        </p>
      </Panel>
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
          <Button type="submit" variant="primary" busy={record.isPending} busyText={t("common.saving")}>
            {t("patient.recordConsent")}
          </Button>
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
    <Panel title={t("patient.login")}>
      <div className="p-4">
        {patient.has_login ? (
          <>
            <p className="text-ink-700">{t("patient.loginExists")}</p>
            <Button className="mt-3" onClick={() => setConfirmReset(true)}>
              {t("patient.resetPassword")}
            </Button>
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
              <Button type="submit" busy={create.isPending} busyText={t("common.saving")}>
                {t("patient.createLogin")}
              </Button>
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
            <Button onClick={() => setConfirmReset(false)}>{t("common.cancel")}</Button>
            <Button variant="primary" busy={reset.isPending} busyText={t("common.saving")} onClick={() => reset.mutate()}>
              {t("patient.resetConfirm")}
            </Button>
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
    </Panel>
  );
}

function DetailsPanel({ patient }: { patient: Patient }) {
  const { t, i18n } = useTranslation();
  const rows: [string, string][] = [
    [t("patientForm.birthYear"), String(patient.birth_year)],
    [t("patientForm.sex"), t(`sex.${patient.sex}`)],
    [t("patientForm.height"), patient.height_cm ? t("units.cm", { value: formatNumber(patient.height_cm, i18n.language) }) : "—"],
    [t("patientForm.weight"), patient.weight_kg ? t("units.kg", { value: formatNumber(patient.weight_kg, i18n.language) }) : "—"],
    [t("patient.addedOn"), formatDate(patient.created_at, i18n.language)],
  ];
  return (
    <Panel
      title={t("patient.details")}
      actions={
        <ButtonLink to={`/doctor/patients/${patient.id}/edit`} variant="ghost" className="min-h-9 px-3">
          {t("patient.edit")}
        </ButtonLink>
      }
    >
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 px-4 py-4">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-label text-ink-500">{label}</dt>
            <dd className="text-right tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

function DeletePanel({ patient }: { patient: Patient }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
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
    <section className="rounded-card border border-danger/25 p-4">
      <h2 className="text-label font-semibold tracking-wide text-danger uppercase">{t("patient.deleteSection")}</h2>
      <p className="mt-1 text-label text-ink-500">{t("patient.deleteHint")}</p>
      <Button variant="danger" className="mt-3" onClick={() => setOpen(true)}>
        {t("patient.delete")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setTyped("");
        }}
        title={t("patient.deleteTitle", { name: patient.full_name })}
        description={t("patient.deleteBody", { count: exams?.length ?? 0 })}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>{t("patient.keep")}</Button>
            <Button
              variant="danger"
              disabled={!matches}
              busy={remove.isPending}
              busyText={t("common.deleting")}
              onClick={() => remove.mutate()}
            >
              {t("patient.delete")}
            </Button>
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
    </section>
  );
}
