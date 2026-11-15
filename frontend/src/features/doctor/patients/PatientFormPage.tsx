import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { type FormEvent, type RefObject, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useBlocker, useNavigate, useParams } from "react-router";

import { me } from "../../../api/auth";
import { errorMessage } from "../../../api/client";
import { doctorApi, type Patient, type PatientInput, type Sex } from "../../../api/doctor";
import { useSession } from "../../../app/session";
import { Dialog } from "../../../components/ui/Dialog";
import { ErrorState, SkeletonRows } from "../../../components/ui/States";
import { Button, ButtonLink, DAlert, FormGroup, TitleToolbar } from "../../../redesign/components";
import { Icon } from "../../../redesign/Icon";

type Form = { fullName: string; birthYear: string; sex: Sex | ""; height: string; weight: string; consent: boolean };
type Field = "fullName" | "birthYear" | "sex" | "height" | "weight";
type Problems = Partial<Record<Field, string>>;

const EMPTY: Form = { fullName: "", birthYear: "", sex: "", height: "", weight: "", consent: false };
const SEXES: Sex[] = ["female", "male", "other"];
const FIELDS: Field[] = ["fullName", "birthYear", "sex", "height", "weight"];

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

const number = (text: string) => Number(text.trim().replace(",", ".")); // "70,5" is how many people type decimals here

/** Client checks mirror the backend (app/schemas/doctor.py); the server stays the real guard. */
export function validate(form: Form, now = new Date()): Problems {
  const problems: Problems = {};
  if (!form.fullName.trim()) problems.fullName = "patientForm.errors.fullName";
  const year = Number(form.birthYear);
  if (!/^\d{4}$/.test(form.birthYear) || year < 1900 || year > now.getFullYear()) {
    problems.birthYear = "patientForm.errors.birthYear";
  }
  if (!form.sex) problems.sex = "patientForm.errors.sex";
  const height = number(form.height);
  if (!form.height.trim() || !(height >= 30 && height <= 250)) problems.height = "patientForm.errors.height";
  const weight = number(form.weight);
  if (!form.weight.trim() || !(weight >= 2 && weight <= 400)) problems.weight = "patientForm.errors.weight";
  return problems;
}

function toInput(form: Form): PatientInput {
  return {
    full_name: form.fullName.trim(),
    birth_year: Number(form.birthYear),
    sex: form.sex as Sex,
    height_cm: number(form.height),
    weight_kg: number(form.weight),
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

/**
 * New patient / edit patient (design "New patient", desktop + tablet + phone): details, measurements and consent. Errors show when a field is left
 * and as a summary after a failed save; a new patient ends in a "Patient created" dialog.
 */
function PatientForm({ patient }: { patient?: Patient }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const current = useSession();
  const account = useQuery({ queryKey: ["me", current?.token], queryFn: me, enabled: !!current, staleTime: 60_000 });
  const initial = useMemo(() => (patient ? fromPatient(patient) : EMPTY), [patient]);
  const [form, setForm] = useState<Form>(initial);
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [created, setCreated] = useState<Patient | null>(null);
  const ids = { fullName: useId(), birthYear: useId(), sex: useId(), height: useId(), weight: useId() };
  const fullNameRef = useRef<HTMLInputElement>(null);
  const birthYearRef = useRef<HTMLInputElement>(null);
  const sexRef = useRef<HTMLInputElement>(null);
  const heightRef = useRef<HTMLInputElement>(null);
  const weightRef = useRef<HTMLInputElement>(null);
  /** Move focus to a field (only called from event handlers). */
  const focusField = (field: Field) =>
    ({ fullName: fullNameRef, birthYear: birthYearRef, sex: sexRef, height: heightRef, weight: weightRef })[field].current?.focus();
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  const save = useMutation({
    mutationFn: () =>
      patient
        ? doctorApi.updatePatient(patient.id, toInput(form))
        : doctorApi.createPatient({ ...toInput(form), consent_given: form.consent }),
    onSuccess: (saved) => {
      queryClient.setQueryData(["patient", saved.id], saved);
      void queryClient.invalidateQueries({ queryKey: ["patients"] });
      if (patient) navigate(`/doctor/patients/${saved.id}`, { state: { saved: true } });
      else setCreated(saved);
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
  const touch = (field: Field) => () => setTouched((x) => ({ ...x, [field]: true }));

  const found = validate(form);
  const year = new Date().getFullYear();
  const shown = (field: Field) => (submitted || touched[field] ? found[field] : undefined);
  const err = (field: Field) => (shown(field) ? t(shown(field)!, { year }) : undefined);
  const summary = submitted ? FIELDS.filter((field) => found[field]) : [];

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (save.isPending) return;
    setSubmitted(true);
    // Focus the first invalid field, in the order they appear on screen.
    const first = FIELDS.find((field) => found[field]);
    if (first) return focusField(first);
    save.mutate();
  };
  const failure = save.isError ? errorMessage(save.error) : null;
  const backTo = patient ? `/doctor/patients/${patient.id}` : "/doctor/patients";
  const age = /^\d{4}$/.test(form.birthYear) && !found.birthYear ? year - Number(form.birthYear) : null;
  const clinic = account.data?.clinic ?? null;
  const title = patient ? t("patientForm.editTitle", { name: patient.full_name }) : t("patientForm.newTitle");

  return (
    <div className="flex flex-col gap-6">
      <TitleToolbar
        crumbsLabel={t("registry.crumbsLabel")}
        crumbs={[
          { label: t("registry.crumbRoot") },
          { label: t("registry.title"), href: "/doctor/patients" },
          ...(patient ? [{ label: patient.full_name, href: backTo }] : []),
          { label: patient ? t("patient.edit") : t("patientForm.newTitle") },
        ]}
        title={title}
        description={patient ? undefined : t("patientForm.lead")}
      />

      <form onSubmit={submit} noValidate aria-label={title} aria-busy={save.isPending} className="rd-dcard w-full max-w-[760px]">
        {(summary.length > 0 || failure) && (
          <div className="rd-sec" style={{ paddingBottom: 0 }}>
            <DAlert tone="crit" icon="alertOctagon">
              {failure ? (
                t(failure.key, failure.values ?? {})
              ) : (
                <>
                  <strong>{t("patientForm.fixFields", { count: summary.length })}</strong>
                  <ul className="rd-errlist">
                    {summary.map((field) => (
                      <li key={field}>
                        <a
                          href={`#${ids[field]}`}
                          onClick={(event) => {
                            event.preventDefault();
                            focusField(field);
                          }}
                        >
                          {t(`patientForm.fieldNames.${field}`)}
                        </a>
                        : {t(found[field]!, { year })}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </DAlert>
          </div>
        )}

        <section className="rd-sec" aria-label={t("patientForm.sectionDetails")}>
          <FormGroup label={t("patientForm.fullName")} required htmlFor={ids.fullName} error={err("fullName")}>
            <div className={clsx("rd-field rd-field--lg", err("fullName") && "rd-field--invalid")}>
              <input
                ref={fullNameRef}
                id={ids.fullName}
                name="full_name"
                type="text"
                autoComplete="off"
                maxLength={200}
                placeholder={t("patientForm.fullNamePlaceholder")}
                aria-required="true"
                aria-invalid={!!err("fullName")}
                aria-describedby={`${ids.fullName}-help`}
                value={form.fullName}
                onChange={(e) => set("fullName")(e.target.value)}
                onBlur={touch("fullName")}
              />
            </div>
          </FormGroup>
          <div className="rd-fgrid">
            <FormGroup label={t("patientForm.birthYear")} required htmlFor={ids.birthYear} error={err("birthYear")}>
              <div className={clsx("rd-field rd-field--lg", err("birthYear") && "rd-field--invalid")}>
                <input
                  ref={birthYearRef}
                  id={ids.birthYear}
                  name="birth_year"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={4}
                  placeholder={t("patientForm.birthYearPlaceholder")}
                  aria-required="true"
                  aria-invalid={!!err("birthYear")}
                  aria-describedby={`${ids.birthYear}-help`}
                  className="tabular-nums"
                  value={form.birthYear}
                  onChange={(e) => set("birthYear")(e.target.value.replace(/\D/g, ""))}
                  onBlur={touch("birthYear")}
                />
                {age !== null && <span className="rd-unit">{t("patientForm.age", { count: age })}</span>}
              </div>
            </FormGroup>
            <SexField
              id={ids.sex}
              inputRef={sexRef}
              value={form.sex}
              error={err("sex")}
              onChange={(value) => {
                set("sex")(value);
                touch("sex")();
              }}
            />
          </div>
        </section>

        <section className="rd-sec" aria-label={t("patientForm.sectionMeasurements")}>
          <div className="rd-fgrid">
            <FormGroup label={t("patientForm.height")} required htmlFor={ids.height} error={err("height")}>
              <div className={clsx("rd-field rd-field--lg", err("height") && "rd-field--invalid")}>
                <input
                  ref={heightRef}
                  id={ids.height}
                  name="height_cm"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder={t("patientForm.heightPlaceholder")}
                  aria-required="true"
                  aria-invalid={!!err("height")}
                  aria-describedby={`${ids.height}-help`}
                  value={form.height}
                  onChange={(e) => set("height")(e.target.value)}
                  onBlur={touch("height")}
                />
                <span className="rd-unit" aria-hidden="true">
                  {t("units.cmShort")}
                </span>
              </div>
            </FormGroup>
            <FormGroup label={t("patientForm.weight")} required htmlFor={ids.weight} error={err("weight")}>
              <div className={clsx("rd-field rd-field--lg", err("weight") && "rd-field--invalid")}>
                <input
                  ref={weightRef}
                  id={ids.weight}
                  name="weight_kg"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder={t("patientForm.weightPlaceholder")}
                  aria-required="true"
                  aria-invalid={!!err("weight")}
                  aria-describedby={`${ids.weight}-help`}
                  value={form.weight}
                  onChange={(e) => set("weight")(e.target.value)}
                  onBlur={touch("weight")}
                />
                <span className="rd-unit" aria-hidden="true">
                  {t("units.kgShort")}
                </span>
              </div>
            </FormGroup>
          </div>
        </section>

        {!patient && (
          <section className="rd-sec" aria-label={t("patientForm.sectionConsent")}>
            <label className="rd-consent">
              <input type="checkbox" checked={form.consent} onChange={(e) => set("consent")(e.target.checked)} />
              <span className="flex flex-col gap-1">
                <span className="rd-label">{t("patientForm.consent")}</span>
                <span className="rd-sm">{t("patientForm.consentHint")}</span>
              </span>
            </label>
          </section>
        )}

        <div className="rd-footbar rd-footbar--form" style={{ justifyContent: "flex-end" }}>
          <ButtonLink to={backTo}>{t("common.cancel")}</ButtonLink>
          <Button
            type="submit"
            variant="primary"
            icon={patient ? undefined : "userPlus"}
            busy={save.isPending}
            busyText={t("common.saving")}
          >
            {patient ? t("patientForm.saveChanges") : t("patientForm.save")}
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

      <CreatedDialog patient={created} clinic={created?.clinic ?? clinic} onClose={() => navigate("/doctor/patients")} />
    </div>
  );
}

/** "Patient created": what was saved, and the next step. Recording needs the consent, so without it the next step is the patient page. */
function CreatedDialog({ patient, clinic, onClose }: { patient: Patient | null; clinic: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const consent = !!patient?.consent_given_at;
  return (
    <Dialog
      open={!!patient}
      onOpenChange={(open) => !open && onClose()}
      title={t("patientForm.createdTitle")}
      description={
        patient
          ? clinic
            ? t("patientForm.createdBody", { name: patient.full_name, clinic })
            : t("patientForm.createdBodyNoClinic", { name: patient.full_name })
          : undefined
      }
      footer={
        <>
          <Button onClick={onClose}>{t("patientForm.backToPatients")}</Button>
          {patient &&
            (consent ? (
              <ButtonLink to={`/doctor/patients/${patient.id}/exam`} variant="primary" icon="mic">
                {t("patient.recordAuscultation")}
              </ButtonLink>
            ) : (
              <ButtonLink to={`/doctor/patients/${patient.id}`} variant="primary">
                {t("patientForm.openProfile")}
              </ButtonLink>
            ))}
        </>
      }
    />
  );
}

function SexField({
  id,
  value,
  error,
  onChange,
  inputRef,
}: {
  id: string;
  value: Sex | "";
  error?: string;
  onChange: (value: Sex) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const { t } = useTranslation();
  return (
    <fieldset id={id} aria-describedby={error ? `${id}-help` : undefined} className="rd-fgrp m-0 border-0 p-0">
      <legend className="rd-label mb-2 p-0">
        {t("patientForm.sex")}{" "}
        <span style={{ color: "var(--c-critical-fg)" }} aria-hidden="true">
          *
        </span>
      </legend>
      <div className={clsx("rd-opts", error && "rd-opts--invalid")}>
        {SEXES.map((option, index) => (
          <label key={option} className={clsx("rd-opt", value === option && "rd-opt--on")}>
            <input
              ref={index === 0 ? inputRef : undefined}
              type="radio"
              name="sex"
              value={option}
              checked={value === option}
              onChange={() => onChange(option)}
            />
            {t(`sex.${option}`)}
          </label>
        ))}
      </div>
      {error && (
        <span id={`${id}-help`} className="rd-sm rd-fgrp__err" style={{ color: "var(--c-critical-fg)" }}>
          <Icon name="alertTriangle" size="sm" />
          <span>{error}</span>
        </span>
      )}
    </fieldset>
  );
}
