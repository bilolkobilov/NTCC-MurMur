import { useMutation, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useBlocker } from "react-router";

import { adminApi } from "../../api/admin";
import { ApiError, errorMessage } from "../../api/client";
import { Alert } from "../../components/ui/Alert";
import { Button, ButtonLink } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { SecretRow } from "../../components/ui/SecretDialog";
import { Panel } from "../../components/ui/States";
import { TextField } from "../../components/ui/TextField";
import { MIN_PASSWORD, PasswordField, USERNAME } from "./doctorFields";

type Form = { fullName: string; clinic: string; username: string; password: string };
type Problems = Partial<Record<"fullName" | "username" | "password", string>>;
type Created = { name: string; username: string; password: string };

const EMPTY: Form = { fullName: "", clinic: "", username: "", password: "" };

/** Client checks mirror the backend (app/schemas/admin.py, common.py); the server stays the real guard. */
export function validate(form: Form): Problems {
  const problems: Problems = {};
  if (!form.fullName.trim()) problems.fullName = "doctors.nameRequired";
  if (!USERNAME.test(form.username.trim())) problems.username = "patient.usernameRule";
  if (form.password.length < MIN_PASSWORD) problems.password = "doctors.passwordRule";
  return problems;
}

/** Add a doctor: step 1 details, step 2 the login to hand over (shown once, kept only in this page's state). */
export function DoctorFormPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Form>(EMPTY);
  const [problems, setProblems] = useState<Problems>({});
  const [created, setCreated] = useState<Created | null>(null);
  const fullNameRef = useRef<HTMLInputElement>(null);
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const dirty = !created && JSON.stringify(form) !== JSON.stringify(EMPTY);

  const create = useMutation({
    mutationFn: () =>
      adminApi.createDoctor({
        full_name: form.fullName.trim(),
        username: form.username.trim(),
        password: form.password,
        clinic: form.clinic.trim() || null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "doctors"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "stats"] });
      setCreated({ name: form.fullName.trim(), username: form.username.trim(), password: form.password });
      setForm(EMPTY);
    },
  });

  // Unsaved input: warn when leaving inside the app (router) and when closing/reloading the tab.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => dirty && !create.isPending && currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const set = (key: keyof Form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (create.isPending) return;
    const found = validate(form);
    setProblems(found);
    const first = (
      [
        ["fullName", fullNameRef],
        ["username", usernameRef],
        ["password", passwordRef],
      ] as const
    ).find(([key]) => found[key]);
    if (first) return first[1].current?.focus();
    create.mutate();
  };
  const another = () => {
    setCreated(null);
    setProblems({});
    create.reset();
  };
  const err = (key: keyof Problems) => (problems[key] ? t(problems[key]!, { min: MIN_PASSWORD }) : undefined);
  const failure =
    create.error instanceof ApiError && create.error.status === 409
      ? t("patient.usernameTaken")
      : create.isError
        ? t(errorMessage(create.error).key)
        : null;

  return (
    <div className="mx-auto max-w-5xl">
      <nav aria-label={t("doctors.crumbs")} className="mb-3">
        <ol className="flex flex-wrap items-center gap-2 text-caption text-ink-500">
          <li>{t("doctors.crumbAdmin")}</li>
          <li aria-hidden="true">›</li>
          <li>
            <Link to="/admin/doctors" className="underline-offset-2 hover:underline">
              {t("doctors.title")}
            </Link>
          </li>
          <li aria-hidden="true">›</li>
          <li aria-current="page" className="font-semibold text-ink-900">
            {t("doctors.add")}
          </li>
        </ol>
      </nav>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-headline font-semibold">{t("doctors.add")}</h1>
          <p className="mt-1 text-ink-500">{t("doctors.addBody")}</p>
        </div>
        <ol aria-label={t("doctors.steps")} className="flex items-center gap-5">
          <Step n={created ? "✓" : "1"} state={created ? "done" : "on"} label={t("doctors.stepDetails")} />
          <Step n="2" state={created ? "on" : "off"} label={t("doctors.stepCredentials")} />
        </ol>
      </div>

      <div className="flex flex-col items-start gap-4 lg:flex-row">
        <div className="w-full min-w-0 flex-1">
          {created ? (
            <section aria-labelledby="done-title" className="rounded-card border border-line bg-surface">
              <div className="flex flex-col gap-4 p-6">
                <Alert tone="clear">{t("doctors.created", { name: created.name })}</Alert>
                <div>
                  <h2 id="done-title" className="text-title font-semibold">
                    {t("doctors.credentialsTitle")}
                  </h2>
                  <p className="mt-1 text-ink-500">{t("doctors.handOverBody")}</p>
                </div>
                <dl className="flex flex-col gap-3">
                  <SecretRow label={t("login.username")} value={created.username} />
                  <SecretRow label={t("login.password")} value={created.password} />
                </dl>
              </div>
              <div className="flex flex-col-reverse gap-2 border-t border-line px-6 py-4 sm:flex-row sm:justify-between">
                <Button onClick={another}>{t("doctors.addAnother")}</Button>
                <ButtonLink to="/admin/doctors" variant="primary">
                  {t("doctors.viewDoctors")}
                </ButtonLink>
              </div>
            </section>
          ) : (
            <form onSubmit={submit} noValidate aria-labelledby="form-title" className="rounded-card border border-line bg-surface">
              <div className="flex items-center justify-between gap-3 border-b border-line px-6 py-4">
                <h2 id="form-title" className="text-title font-semibold">
                  {t("doctors.detailsTitle")}
                </h2>
                <span className="text-caption text-ink-500">{t("doctors.requiredNote")}</span>
              </div>
              <div className="flex flex-col gap-5 p-6">
                {failure && <Alert tone="danger">{failure}</Alert>}
                <div className="grid gap-5 sm:grid-cols-2">
                  <TextField
                    ref={fullNameRef}
                    label={t("doctors.fullName")}
                    required
                    autoComplete="off"
                    maxLength={200}
                    error={err("fullName")}
                    value={form.fullName}
                    onChange={(e) => set("fullName")(e.target.value)}
                  />
                  <TextField
                    label={t("doctors.clinic")}
                    autoComplete="off"
                    maxLength={200}
                    hint={t("doctors.clinicHint")}
                    value={form.clinic}
                    onChange={(e) => set("clinic")(e.target.value)}
                  />
                </div>
                <TextField
                  ref={usernameRef}
                  label={t("login.username")}
                  required
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  translate="no"
                  hint={t("patient.usernameRule")}
                  error={err("username")}
                  value={form.username}
                  onChange={(e) => set("username")(e.target.value)}
                />
                <PasswordField inputRef={passwordRef} value={form.password} onChange={set("password")} error={err("password")} />
                <Alert tone="info">{t("doctors.shownOnce")}</Alert>
              </div>
              <div className="flex flex-col-reverse gap-2 border-t border-line px-6 py-4 sm:flex-row sm:justify-between">
                <ButtonLink to="/admin/doctors" variant="ghost">
                  {t("common.cancel")}
                </ButtonLink>
                <Button type="submit" variant="primary" busy={create.isPending} busyText={t("common.saving")}>
                  {t("doctors.create")}
                </Button>
              </div>
            </form>
          )}
        </div>

        <aside aria-label={t("doctors.accessTitle")} className="w-full lg:w-80 lg:shrink-0">
          <Panel title={t("doctors.accessTitle")}>
            <ul className="flex list-disc flex-col gap-2 py-4 pr-4 pl-8 text-body text-ink-700">
              <li>{t("doctors.access1")}</li>
              <li>{t("doctors.access2")}</li>
              <li>{t("doctors.access3")}</li>
            </ul>
          </Panel>
        </aside>
      </div>

      <Dialog
        open={blocker.state === "blocked"}
        onOpenChange={(open) => !open && blocker.reset?.()}
        title={t("patientForm.leaveTitle")}
        description={t("doctors.leaveBody")}
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

function Step({ n, state, label }: { n: string; state: "on" | "done" | "off"; label: string }) {
  return (
    <li className="flex items-center gap-2" aria-current={state === "on" ? "step" : undefined}>
      <span
        aria-hidden="true"
        className={clsx(
          "inline-flex size-7 items-center justify-center rounded-full text-caption font-bold",
          state === "off" ? "bg-canvas text-ink-500" : "bg-ink-900 text-white",
        )}
      >
        {n}
      </span>
      <span className={clsx("text-label font-medium", state === "off" ? "text-ink-500" : "text-ink-900")}>{label}</span>
    </li>
  );
}
