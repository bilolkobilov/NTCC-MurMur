import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { type FormEvent, useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { errorMessage } from "../../../api/client";
import { doctorApi, type Patient, type VitalsInput } from "../../../api/doctor";
import { Dialog } from "../../../components/ui/Dialog";
import { formatDateTime } from "../../../lib/format";
import { Button, DAlert, DCard, FormGroup } from "../../../redesign/components";

type Tile = { key: string; name: string; value: string; unit: string; known: boolean };

/** Body-mass index from height (cm) and weight (kg). */
export const bmi = (heightCm: number, weightKg: number) => weightKg / (heightCm / 100) ** 2;

/**
 * "Vital signs" (design "Patient profile"): heart rate, blood pressure, SpO₂, breathing rate, temperature and BMI, as
 * plain numbers. No "normal / abnormal" word: the ranges were not set by a doctor (owner, 2026-11-17). The doctor enters
 * the first five; BMI comes from height and weight.
 */
export function VitalsCard({ patient }: { patient: Patient }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const vitals = useQuery({ queryKey: ["vitals", patient.id], queryFn: () => doctorApi.latestVitals(patient.id) });
  const v = vitals.data;
  const dash = "—";
  const number = (n: number) => new Intl.NumberFormat(i18n.language).format(n);
  const decimal = (n: number) =>
    new Intl.NumberFormat(i18n.language, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n);
  const bmiValue = patient.height_cm && patient.weight_kg ? bmi(patient.height_cm, patient.weight_kg) : null;

  const tiles: Tile[] = [
    {
      key: "heart_rate",
      name: t("vitals.heartRate"),
      value: v?.heart_rate != null ? number(v.heart_rate) : dash,
      unit: t("vitals.unit.bpm"),
      known: v?.heart_rate != null,
    },
    {
      key: "bp",
      name: t("vitals.bloodPressure"),
      value: v?.systolic != null && v.diastolic != null ? `${v.systolic}/${v.diastolic}` : dash,
      unit: t("vitals.unit.mmHg"),
      known: v?.systolic != null && v.diastolic != null,
    },
    {
      key: "spo2",
      name: t("vitals.spo2"),
      value: v?.spo2 != null ? number(v.spo2) : dash,
      unit: "%",
      known: v?.spo2 != null,
    },
    {
      key: "resp_rate",
      name: t("vitals.respRate"),
      value: v?.resp_rate != null ? number(v.resp_rate) : dash,
      unit: t("vitals.unit.perMin"),
      known: v?.resp_rate != null,
    },
    {
      key: "temp",
      name: t("vitals.temperature"),
      value: v?.temp_c != null ? decimal(v.temp_c) : dash,
      unit: "°C",
      known: v?.temp_c != null,
    },
    {
      key: "bmi",
      name: t("patient.bmi"),
      value: bmiValue ? decimal(bmiValue) : dash,
      unit: t("patient.bmiUnit"),
      known: bmiValue !== null,
    },
  ];

  return (
    <DCard
      id="h-vitals"
      title={t("vitals.title")}
      icon="activity"
      meta={
        <div className="flex flex-wrap items-center gap-3">
          <span className="rd-sm">
            {v
              ? t("vitals.measured", { when: formatDateTime(v.created_at, i18n.language), by: v.recorded_by })
              : vitals.isPending
                ? t("common.loading")
                : t("vitals.none")}
          </span>
          <Button icon="plus" onClick={() => setOpen(true)}>
            {t("vitals.record")}
          </Button>
        </div>
      }
    >
      <div className="rd-metrics">
        {tiles.map((tile) => (
          <div className="rd-metric" key={tile.key}>
            <span className="rd-sm" style={{ fontWeight: 500 }}>
              {tile.name}
            </span>
            <span className="rd-metric__val tabular-nums">
              {tile.value}
              {tile.known && <span className="rd-metric__unit">{tile.unit}</span>}
            </span>
            {!tile.known && <span className="rd-sm">{t("vitals.level.none")}</span>}
          </div>
        ))}
      </div>
      <VitalsDialog patient={patient} open={open} onOpenChange={setOpen} />
    </DCard>
  );
}

const FIELDS = ["heart_rate", "systolic", "diastolic", "spo2", "resp_rate", "temp_c"] as const;
type Field = (typeof FIELDS)[number];
type Form = Record<Field, string>;
const EMPTY: Form = { heart_rate: "", systolic: "", diastolic: "", spo2: "", resp_rate: "", temp_c: "" };
// Mirrors the backend limits (app/schemas/doctor.py VitalsCreate).
const LIMITS: Record<Field, [number, number]> = {
  heart_rate: [20, 300],
  systolic: [50, 300],
  diastolic: [20, 200],
  spo2: [50, 100],
  resp_rate: [4, 80],
  temp_c: [30, 45],
};

const num = (text: string) => Number(text.trim().replace(",", "."));

/** Client checks mirror the backend; returns an i18n key per bad field, or "form" for "nothing entered". */
export function validateVitals(form: Form): Partial<Record<Field | "form", string>> {
  const problems: Partial<Record<Field | "form", string>> = {};
  for (const field of FIELDS) {
    const text = form[field].trim();
    if (!text) continue;
    const [lo, hi] = LIMITS[field];
    const value = num(text);
    if (!(value >= lo && value <= hi)) problems[field] = "vitals.errors.range";
  }
  const hasSys = !!form.systolic.trim();
  const hasDia = !!form.diastolic.trim();
  if (hasSys !== hasDia) problems[hasSys ? "diastolic" : "systolic"] = "vitals.errors.bothNumbers";
  else if (hasSys && !problems.systolic && !problems.diastolic && num(form.systolic) <= num(form.diastolic)) {
    problems.systolic = "vitals.errors.order";
  }
  if (FIELDS.every((f) => !form[f].trim())) problems.form = "vitals.errors.empty";
  return problems;
}

function VitalsDialog({ patient, open, onOpenChange }: { patient: Patient; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const ids = { heart_rate: useId(), systolic: useId(), diastolic: useId(), spo2: useId(), resp_rate: useId(), temp_c: useId() };
  const [form, setForm] = useState<Form>(EMPTY);
  const [submitted, setSubmitted] = useState(false);
  const problems = validateVitals(form);

  const save = useMutation({
    mutationFn: () => {
      const value = (f: Field): number | null => (form[f].trim() ? num(form[f]) : null);
      const input: VitalsInput = {
        heart_rate: value("heart_rate"),
        systolic: value("systolic"),
        diastolic: value("diastolic"),
        spo2: value("spo2"),
        resp_rate: value("resp_rate"),
        temp_c: value("temp_c"),
      };
      return doctorApi.recordVitals(patient.id, input);
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(["vitals", patient.id], saved);
      close(false);
    },
  });

  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setForm(EMPTY);
      setSubmitted(false);
      save.reset();
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (save.isPending) return;
    setSubmitted(true);
    if (Object.keys(problems).length > 0) return;
    save.mutate();
  };
  const failure = save.isError ? errorMessage(save.error) : null;
  const field = (name: Field, label: string, unit: string, mode: "numeric" | "decimal") => {
    const error = submitted && problems[name] ? t(problems[name]!, { min: LIMITS[name][0], max: LIMITS[name][1] }) : undefined;
    return (
      <FormGroup label={label} htmlFor={ids[name]} error={error}>
        <div className={clsx("rd-field", error && "rd-field--invalid")}>
          <input
            id={ids[name]}
            type="text"
            inputMode={mode}
            autoComplete="off"
            aria-invalid={!!error}
            aria-describedby={`${ids[name]}-help`}
            value={form[name]}
            onChange={(e) => setForm((f) => ({ ...f, [name]: e.target.value }))}
          />
          <span className="rd-unit" aria-hidden="true">
            {unit}
          </span>
        </div>
      </FormGroup>
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={t("vitals.record")}
      description={t("vitals.recordBody", { name: patient.full_name })}
      footer={
        <>
          <Button onClick={() => close(false)}>{t("common.cancel")}</Button>
          <Button type="submit" form="vitals-form" variant="primary" busy={save.isPending} busyText={t("common.saving")}>
            {t("vitals.save")}
          </Button>
        </>
      }
    >
      <form id="vitals-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {submitted && problems.form && <DAlert tone="crit" icon="alertOctagon">{t(problems.form)}</DAlert>}
        {failure && (
          <DAlert tone="crit" icon="alertOctagon">
            {t(failure.key, failure.values ?? {})}
          </DAlert>
        )}
        <div className="rd-fgrid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 16 }}>
          {field("heart_rate", t("vitals.heartRate"), t("vitals.unit.bpm"), "numeric")}
          {field("spo2", t("vitals.spo2"), "%", "numeric")}
          {field("systolic", t("vitals.systolic"), t("vitals.unit.mmHg"), "numeric")}
          {field("diastolic", t("vitals.diastolic"), t("vitals.unit.mmHg"), "numeric")}
          {field("resp_rate", t("vitals.respRate"), t("vitals.unit.perMin"), "numeric")}
          {field("temp_c", t("vitals.temperature"), "°C", "decimal")}
        </div>
      </form>
    </Dialog>
  );
}
