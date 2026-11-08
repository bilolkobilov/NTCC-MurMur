import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useBlocker, useNavigate, useParams } from "react-router";

import { errorMessage } from "../../../api/client";
import { doctorApi, type Patient, type PatientInput, type Sex } from "../../../api/doctor";
import { Alert } from "../../../components/ui/Alert";
import { Button, ButtonLink } from "../../../components/ui/Button";
import { Dialog } from "../../../components/ui/Dialog";
import { ErrorState, PageHeader, SkeletonRows } from "../../../components/ui/States";
import { TextField } from "../../../components/ui/TextField";

type Form = { fullName: string; birthYear: string; sex: Sex | ""; height: string; weight: string; consent: boolean };
type Problems = Partial<Record<"fullName" | "birthYear" | "sex" | "height" | "weight", string>>;

const EMPTY: Form = { fullName: "", birthYear: "", sex: "", height: "", weight: "", consent: false };

function fromPatient(p: Patient): Form {
  return {
    fullName: p.full_name,
    birthYear: String(p.birth_year),
    sex: p.sex,
    height: p.height_cm == null ? "" : String(p.height_cm),
    weight: p.weight_kg == null ? "" : String(p.weight_kg),
    consent: !!p.consent_given_at,
  };
}

const number = (text: string) => Number(text.replace(",", ".")); // "70,5" is how many people type decimals here

/** Client checks mirror the backend (app/schemas/doctor.py); the server stays the real guard. */
export function validate(form: Form, now = new Date()): Problems {
  const problems: Problems = {};
  if (!form.fullName.trim()) problems.fullName = "patientForm.errors.fullName";
  const year = Number(form.birthYear);
  if (!/^\d{4}$/.test(form.birthYear) || year < 1900 || year > now.getFullYear()) {
    problems.birthYear = "patientForm.errors.birthYear";
  }
  if (!form.sex) problems.sex = "patientForm.errors.sex";
  if (form.height && !(number(form.height) > 0 && number(form.height) < 300)) problems.height = "patientForm.errors.height";
  if (form.weight && !(number(form.weight) > 0 && number(form.weight) < 500)) problems.weight = "patientForm.errors.weight";
  return problems;
}

function toInput(form: Form): PatientInput {
  return {
    full_name: form.fullName.trim(),
    birth_year: Number(form.birthYear),
    sex: form.sex as Sex,
    height_cm: form.height ? number(form.height) : null,
    weight_kg: form.weight ? number(form.weight) : null,
  };
}

export function PatientFormPage() {
  const { patientId } = useParams();
  const editing = patientId !== undefined;
  const id = Number(patientId);
  const { t } = useTranslation();
  const existing = useQuery({ queryKey: ["patient", id], queryFn: () => doctorApi.getPatient(id), enabled: editing });

  if (editing && !existing.data) {
    if (existing.isError) return <ErrorState error={existing.error} onRetry={() => void existing.refetch()} />;
    return <SkeletonRows rows={5} label={t("common.loading")} />;
  }
  return <PatientForm key={patientId ?? "new"} patient={existing.data} />;
}

function PatientForm({ patient }: { patient?: Patient }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const initial = useMemo(() => (patient ? fromPatient(patient) : EMPTY), [patient]);
  const [form, setForm] = useState<Form>(initial);
  const [problems, setProblems] = useState<Problems>({});
  const fullNameRef = useRef<HTMLInputElement>(null);
  const birthYearRef = useRef<HTMLInputElement>(null);
  const sexRef = useRef<HTMLInputElement>(null);
  const heightRef = useRef<HTMLInputElement>(null);
  const weightRef = useRef<HTMLInputElement>(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  const save = useMutation({
    mutationFn: () =>
      patient
        ? doctorApi.updatePatient(patient.id, toInput(form))
        : doctorApi.createPatient({ ...toInput(form), consent_given: form.consent }),
    onSuccess: (saved) => {
      queryClient.setQueryData(["patient", saved.id], saved);
      void queryClient.invalidateQueries({ queryKey: ["patients"] });
      navigate(`/doctor/patients/${saved.id}`, { replace: !patient, state: { saved: true } });
    },
  });

  // Unsaved changes: warn when leaving inside the app (router) and when closing/reloading the tab.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    return dirty && !save.isPending && !save.isSuccess && currentLocation.pathname !== nextLocation.pathname;
  });
  useEffect(() => {
    if (!dirty || save.isSuccess) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, save.isSuccess]);

  const set = <K extends keyof Form>(key: K) => (value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (save.isPending) return;
    const found = validate(form);
    setProblems(found);
    // Focus the first invalid field, in the order they appear on screen.
    const order: [keyof Problems, React.RefObject<HTMLInputElement | null>][] = [
      ["fullName", fullNameRef],
      ["birthYear", birthYearRef],
      ["sex", sexRef],
      ["height", heightRef],
      ["weight", weightRef],
    ];
    const first = order.find(([key]) => found[key]);
    if (first) return first[1].current?.focus();
    save.mutate();
  };
  const failure = save.isError ? errorMessage(save.error) : null;
  const err = (key: keyof Problems) => (problems[key] ? t(problems[key]!) : undefined);
  const backTo = patient ? `/doctor/patients/${patient.id}` : "/doctor/patients";

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={patient ? t("patientForm.editTitle", { name: patient.full_name }) : t("patientForm.newTitle")} />
      <form onSubmit={submit} noValidate className="rounded-card border border-line bg-surface">
        <div className="flex flex-col gap-5 p-6">
          {failure && <Alert tone="danger">{t(failure.key, failure.values ?? {})}</Alert>}
          <TextField
            ref={fullNameRef}
            label={t("patientForm.fullName")}
            name="full_name"
            autoComplete="off"
            maxLength={200}
            required
            placeholder={t("patientForm.fullNamePlaceholder")}
            error={err("fullName")}
            value={form.fullName}
            onChange={(e) => set("fullName")(e.target.value)}
          />
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField
              ref={birthYearRef}
              label={t("patientForm.birthYear")}
              name="birth_year"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              required
              placeholder="1990"
              error={err("birthYear")}
              value={form.birthYear}
              onChange={(e) => set("birthYear")(e.target.value.replace(/\D/g, ""))}
              className="tabular-nums"
            />
            <SexField
              inputRef={sexRef}
              value={form.sex}
              error={err("sex")}
              onChange={(value) => set("sex")(value)}
            />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField
              ref={heightRef}
              label={t("patientForm.height")}
              name="height_cm"
              inputMode="decimal"
              autoComplete="off"
              hint={t("patientForm.optional")}
              error={err("height")}
              value={form.height}
              onChange={(e) => set("height")(e.target.value)}
            />
            <TextField
              ref={weightRef}
              label={t("patientForm.weight")}
              name="weight_kg"
              inputMode="decimal"
              autoComplete="off"
              hint={t("patientForm.optional")}
              error={err("weight")}
              value={form.weight}
              onChange={(e) => set("weight")(e.target.value)}
            />
          </div>
          {!patient && (
            <label className="flex cursor-pointer items-start gap-3 rounded-control border border-line p-4 has-[:checked]:border-clear has-[:checked]:bg-clear-bg">
              <input
                type="checkbox"
                checked={form.consent}
                onChange={(e) => set("consent")(e.target.checked)}
                className="mt-0.5 size-5 shrink-0 accent-[var(--color-clear)]"
              />
              <span>
                <span className="block font-medium">{t("patientForm.consent")}</span>
                <span className="block text-label text-ink-500">{t("patientForm.consentHint")}</span>
              </span>
            </label>
          )}
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-line px-6 py-4 sm:flex-row sm:justify-end">
          <ButtonLink to={backTo} variant="ghost">
            {t("common.cancel")}
          </ButtonLink>
          <Button
            type="submit"
            variant="primary"
            busy={save.isPending}
            busyText={t("common.saving")}
          >
            {patient ? t("patientForm.saveChanges") : t("patients.add")}
          </Button>
        </div>
      </form>

      <Dialog
        open={blocker.state === "blocked"}
        onOpenChange={(open) => !open && blocker.reset?.()}
        title={t("patientForm.leaveTitle")}
        description={t("patientForm.leaveBody")}
        footer={
          <>
            <Button onClick={() => blocker.reset?.()}>{t("patientForm.keepEditing")}</Button>
            <Button variant="danger" onClick={() => blocker.proceed?.()}>
              {t("patientForm.leave")}
            </Button>
          </>
        }
      />
    </div>
  );
}

function SexField({
  value,
  error,
  onChange,
  inputRef,
}: {
  value: Sex | "";
  error?: string;
  onChange: (value: Sex) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const { t } = useTranslation();
  return (
    <fieldset aria-describedby={error ? "sex-error" : undefined} aria-invalid={error ? true : undefined}>
      <legend className="mb-1.5 text-label font-medium text-ink-700 after:ml-1 after:text-ink-300 after:content-['*']">
        {t("patientForm.sex")}
      </legend>
      <div className={clsx("grid grid-cols-2 gap-1 rounded-control border bg-field p-1", error ? "border-danger" : "border-line-strong")}>
        {(["male", "female"] as const).map((option, index) => (
          <label
            key={option}
            className="flex min-h-9 cursor-pointer items-center justify-center rounded-[6px] text-body text-ink-700 has-[:checked]:bg-surface has-[:checked]:font-semibold has-[:checked]:text-ink-900 has-[:checked]:shadow-[0_0_0_1px_var(--color-line-strong)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ink-900"
          >
            <input
              ref={index === 0 ? inputRef : undefined}
              type="radio"
              name="sex"
              value={option}
              checked={value === option}
              onChange={() => onChange(option)}
              className="sr-only"
            />
            {t(`sex.${option}`)}
          </label>
        ))}
      </div>
      {error && (
        <p id="sex-error" className="mt-1.5 text-caption font-medium text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
}
