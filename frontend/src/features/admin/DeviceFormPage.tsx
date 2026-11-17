import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useBlocker } from "react-router";

import { adminApi, DEVICE_MODELS, type DeviceWithKey } from "../../api/admin";
import { ApiError, errorMessage } from "../../api/client";
import { Dialog } from "../../components/ui/Dialog";
import { SecretRow } from "../../components/ui/SecretDialog";
import { Breadcrumbs, Button, ButtonLink } from "../../redesign/components";
import { Icon } from "../../redesign/Icon";
import { DAlert, FormGroup, SelectBox } from "./deviceUi";

type Form = { serial: string; model: string; location: string; doctorId: number | null };
const EMPTY: Form = { serial: "", model: DEVICE_MODELS[0], location: "", doctorId: null };

/** Register a device (design "Admin: register device"): step 1 details, step 2 the key for the firmware (shown once). */
export function DeviceFormPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const ids = { serial: useId(), devid: useId(), model: useId(), doctor: useId(), location: useId() };
  const [form, setForm] = useState<Form>(EMPTY);
  const [problem, setProblem] = useState<string | null>(null);
  const [created, setCreated] = useState<DeviceWithKey | null>(null);
  const serialRef = useRef<HTMLInputElement>(null);
  const dirty = !created && JSON.stringify(form) !== JSON.stringify(EMPTY);
  const doctors = useQuery({ queryKey: ["admin", "doctors"], queryFn: adminApi.doctors });

  const create = useMutation({
    mutationFn: () =>
      adminApi.createDevice({
        serial: form.serial.trim(),
        model: form.model,
        location: form.location.trim() || null,
        doctor_id: form.doctorId,
      }),
    onSuccess: (device) => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "devices"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "stats"] });
      setCreated(device);
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

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (create.isPending) return;
    if (!form.serial.trim()) {
      setProblem(t("devices.serialRequired"));
      return serialRef.current?.focus();
    }
    setProblem(null);
    create.mutate();
  };
  const another = () => {
    setCreated(null);
    setProblem(null);
    create.reset();
  };
  const failure =
    create.error instanceof ApiError && create.error.detail === "serial already exists"
      ? t("devices.serialTaken")
      : create.isError
        ? t(errorMessage(create.error).key)
        : null;
  const chosen = doctors.data?.find((d) => d.id === form.doctorId);
  const serialProblem = problem ?? (create.error instanceof ApiError && create.error.detail === "serial already exists" ? failure : null);
  const errorCount = serialProblem ? 1 : 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Breadcrumbs
          label={t("doctors.crumbs")}
          items={[{ label: t("doctors.crumbAdmin") }, { label: t("devices.title"), href: "/admin/devices" }, { label: t("devices.registerTitle") }]}
        />
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="rd-h1">{t("devices.registerTitle")}</h1>
            <p className="rd-body">{t("devices.registerBody")}</p>
          </div>
          <ol aria-label={t("doctors.steps")} className="m-0 flex list-none items-center gap-5 p-0">
            <li className={clsx("rd-step", created && "rd-step--done")} aria-current={created ? undefined : "step"}>
              <span className="rd-step__n">{created ? "✓" : "1"}</span>
              <span className="rd-label">{t("devices.stepDetails")}</span>
            </li>
            <li className="rd-step" aria-current={created ? "step" : undefined}>
              <span className="rd-step__n">2</span>
              <span className="rd-label">{t("devices.stepPair")}</span>
            </li>
          </ol>
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-4">
        {created ? (
          <section className="rd-dcard" style={{ flex: "1 1 560px" }} aria-labelledby="done-h">
            <div className="rd-dcard__body">
              <DAlert tone="ok" icon="checkCircle">
                <strong>{t("devices.created", { code: created.code })}</strong> {t("devices.createdPending")}
              </DAlert>
              <div className="flex flex-col gap-1">
                <h2 className="rd-h3" id="done-h">
                  {t("devices.pairTitle")}
                </h2>
                <p className="rd-body">{t("devices.pairBody")}</p>
              </div>
              <dl className="m-0">
                <SecretRow label={t("devices.apiKey")} value={created.api_key} />
              </dl>
              <span className="rd-sm">{[created.model, created.clinic, created.location].filter(Boolean).join(" · ")}</span>
            </div>
            <div className="rd-footbar rd-footbar--form">
              <Button onClick={another}>{t("devices.addAnother")}</Button>
              <ButtonLink to={`/admin/devices/${created.id}`} variant="primary">
                {t("devices.viewDevice")}
              </ButtonLink>
            </div>
          </section>
        ) : (
          <form onSubmit={submit} noValidate aria-labelledby="form-h" className="rd-dcard" style={{ flex: "1 1 560px" }}>
            <div className="rd-dcard__head">
              <h2 className="rd-h3" id="form-h">
                {t("devices.detailsTitle")}
              </h2>
              <span className="rd-sm">{t("doctors.requiredNote")}</span>
            </div>
            <div className="rd-dcard__body rd-dcard__body--form">
              {errorCount > 0 && (
                <DAlert tone="crit" icon="alertOctagon">
                  {t("devices.fixFields", { count: errorCount })}
                </DAlert>
              )}
              {failure && !serialProblem && (
                <DAlert tone="crit" icon="alertOctagon">
                  {failure}
                </DAlert>
              )}
              <div className="rd-fgrid">
                <FormGroup label={t("devices.serial")} required htmlFor={ids.serial} hint={t("devices.serialHint")} error={serialProblem}>
                  <div className={clsx("rd-field", serialProblem && "rd-field--error")}>
                    <input
                      ref={serialRef}
                      id={ids.serial}
                      type="text"
                      placeholder="SN-0000-0000"
                      autoComplete="off"
                      translate="no"
                      spellCheck={false}
                      maxLength={64}
                      aria-required="true"
                      aria-invalid={!!serialProblem}
                      aria-describedby={`${ids.serial}-help`}
                      value={form.serial}
                      onChange={(e) => setForm((f) => ({ ...f, serial: e.target.value }))}
                    />
                  </div>
                </FormGroup>
                <FormGroup label={t("devices.deviceId")} htmlFor={ids.devid} hint={t("devices.deviceIdHint")}>
                  <div className="rd-field rd-field--readonly">
                    <Icon name="lock" size="sm" />
                    <input id={ids.devid} type="text" readOnly value={t("devices.autoId")} aria-describedby={`${ids.devid}-help`} />
                  </div>
                </FormGroup>
              </div>
              <div className="rd-fgrid">
                <FormGroup label={t("devices.model")} required htmlFor={ids.model}>
                  <SelectBox id={ids.model} value={form.model} onChange={(model) => setForm((f) => ({ ...f, model }))}>
                    {DEVICE_MODELS.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </SelectBox>
                </FormGroup>
                <FormGroup
                  label={t("devices.assignDoctor")}
                  htmlFor={ids.doctor}
                  hint={chosen ? (chosen.clinic ? t("devices.clinicOf", { clinic: chosen.clinic }) : t("doctors.noClinic")) : t("devices.assignHint")}
                >
                  <SelectBox
                    id={ids.doctor}
                    value={form.doctorId === null ? "" : String(form.doctorId)}
                    onChange={(v) => setForm((f) => ({ ...f, doctorId: v ? Number(v) : null }))}
                  >
                    <option value="">{t("devices.unassigned")}</option>
                    {(doctors.data ?? []).map((doctor) => (
                      <option key={doctor.id} value={doctor.id} disabled={!doctor.is_active}>
                        {doctor.full_name}
                        {doctor.clinic ? ` · ${doctor.clinic}` : ""}
                        {doctor.is_active ? "" : ` (${t("doctors.blocked")})`}
                      </option>
                    ))}
                  </SelectBox>
                </FormGroup>
              </div>
              <div className="rd-fgrid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
                <FormGroup label={t("devices.location")} htmlFor={ids.location} hint={t("devices.locationHint")}>
                  <div className="rd-field">
                    <input
                      id={ids.location}
                      type="text"
                      autoComplete="off"
                      maxLength={100}
                      aria-describedby={`${ids.location}-help`}
                      value={form.location}
                      onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                    />
                  </div>
                </FormGroup>
              </div>
              <DAlert tone="info" icon="lock">
                {t("devices.shownOnce")}
              </DAlert>
            </div>
            <div className="rd-footbar rd-footbar--form">
              <ButtonLink to="/admin/devices">{t("common.cancel")}</ButtonLink>
              <Button type="submit" variant="primary" busy={create.isPending} busyText={t("devices.registering")}>
                {t("devices.register")}
              </Button>
            </div>
          </form>
        )}

        <aside aria-label={t("devices.nextTitle")} className="flex flex-col gap-4" style={{ flex: "1 1 320px", minWidth: 0 }}>
          <section className="rd-dcard">
            <div className="rd-dcard__head">
              <h2 className="rd-h3">{t("devices.nextTitle")}</h2>
            </div>
            <ul className="m-0 flex list-disc flex-col gap-2 py-4 pr-5 pl-9">
              <li className="rd-body">{t("devices.next1")}</li>
              <li className="rd-body">{t("devices.next2")}</li>
              <li className="rd-body">{t("devices.next3")}</li>
            </ul>
          </section>
        </aside>
      </div>

      <Dialog
        open={blocker.state === "blocked"}
        onOpenChange={(open) => !open && blocker.reset?.()}
        title={t("patientForm.leaveTitle")}
        description={t("devices.leaveBody")}
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
