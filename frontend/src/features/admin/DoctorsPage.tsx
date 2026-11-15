import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";

import { adminApi, type Doctor } from "../../api/admin";
import { ApiError, errorMessage } from "../../api/client";
import { Alert } from "../../components/ui/Alert";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { SecretDialog } from "../../components/ui/SecretDialog";
import { EmptyState, ErrorState, PageHeader, SkeletonRows } from "../../components/ui/States";
import { TextField } from "../../components/ui/TextField";
import { formatDate, formatNumber } from "../../lib/format";

const USERNAME = /^[A-Za-z0-9._-]{3,64}$/;
const MIN_PASSWORD = 8; // backend NewPassword

/** A readable random password (no look-alike characters), for the admin to hand to the doctor. */
export function generatePassword(length = 12): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint32Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

/** Doctors: create (admin sets the password), block / unblock, reset a forgotten password. */
export function DoctorsPage() {
  const { t, i18n } = useTranslation();
  const doctors = useQuery({ queryKey: ["admin", "doctors"], queryFn: adminApi.doctors });
  const [creating, setCreating] = useState(false);
  const [blocking, setBlocking] = useState<Doctor | null>(null);
  const [resetting, setResetting] = useState<Doctor | null>(null);
  const [editingClinic, setEditingClinic] = useState<Doctor | null>(null);
  const [handOver, setHandOver] = useState<{ title: string; username: string; password: string } | null>(null);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={t("doctors.title")}
        meta={doctors.data && t("doctors.count", { count: doctors.data.length })}
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            {t("doctors.add")}
          </Button>
        }
      />
      <div className="overflow-hidden rounded-card border border-line bg-surface">
        {doctors.isPending && <SkeletonRows rows={4} label={t("common.loading")} />}
        {doctors.isError && !doctors.data && <ErrorState error={doctors.error} onRetry={() => void doctors.refetch()} />}
        {doctors.data?.length === 0 && (
          <EmptyState
            title={t("doctors.emptyTitle")}
            body={t("doctors.emptyBody")}
            action={
              <Button variant="primary" onClick={() => setCreating(true)}>
                {t("doctors.add")}
              </Button>
            }
          />
        )}
        {doctors.data && doctors.data.length > 0 && (
          <ul className="divide-y divide-line">
            {doctors.data.map((doctor) => (
              <li key={doctor.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:gap-6">
                <div className="min-w-0 flex-1">
                  <p className={clsx("truncate font-semibold", !doctor.is_active && "text-ink-500")}>{doctor.full_name}</p>
                  <p className="text-label text-ink-500">
                    <span translate="no" className="font-mono">
                      {doctor.username}
                    </span>
                    {" · "}
                    <span className={doctor.clinic ? undefined : "italic"}>{doctor.clinic ?? t("doctors.noClinic")}</span>
                    {" · "}
                    {t("doctors.patients", { count: doctor.patient_count, formatted: formatNumber(doctor.patient_count, i18n.language) })}
                    {" · "}
                    {t("doctors.since", { date: formatDate(doctor.created_at, i18n.language) })}
                  </p>
                </div>
                <span className={doctor.is_active ? "chip-quiet self-start sm:self-auto" : "chip-finding self-start sm:self-auto"}>
                  {doctor.is_active ? t("doctors.active") : t("doctors.blocked")}
                </span>
                <div className="flex flex-wrap gap-2">
                  <Button variant="ghost" onClick={() => setEditingClinic(doctor)}>
                    {t("doctors.editClinic")}
                  </Button>
                  <Button variant="ghost" onClick={() => setResetting(doctor)}>
                    {t("doctors.resetPassword")}
                  </Button>
                  {doctor.is_active ? (
                    <Button variant="danger" onClick={() => setBlocking(doctor)}>
                      {t("doctors.block")}
                    </Button>
                  ) : (
                    <UnblockButton doctor={doctor} />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* key: a closed dialog forgets what was typed (a password must never carry over to the next doctor) */}
      <CreateDoctorDialog
        key={creating ? "create-open" : "create-closed"}
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(username, password) => {
          setCreating(false);
          setHandOver({ title: t("doctors.createdTitle"), username, password });
        }}
      />
      <ClinicDialog key={editingClinic?.id ?? "clinic-closed"} doctor={editingClinic} onClose={() => setEditingClinic(null)} />
      <BlockDialog doctor={blocking} onClose={() => setBlocking(null)} />
      <ResetPasswordDialog
        key={resetting?.id ?? "reset-closed"}
        doctor={resetting}
        onClose={() => setResetting(null)}
        onDone={(doctor, password) => {
          setResetting(null);
          setHandOver({ title: t("doctors.resetDoneTitle"), username: doctor.username, password });
        }}
      />
      <SecretDialog
        open={!!handOver}
        title={handOver?.title ?? ""}
        description={t("doctors.handOverBody")}
        secrets={
          handOver
            ? [
                { label: t("login.username"), value: handOver.username },
                { label: t("login.password"), value: handOver.password },
              ]
            : []
        }
        acknowledge={t("doctors.handOverDone")}
        onClose={() => setHandOver(null)}
      />
    </div>
  );
}

function useDoctorsRefresh() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["admin", "doctors"] });
    void queryClient.invalidateQueries({ queryKey: ["admin", "stats"] });
  };
}

function PasswordField({ value, onChange, error }: { value: string; onChange: (v: string) => void; error?: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-end gap-2">
      <TextField
        className="flex-1"
        label={t("login.password")}
        required
        autoComplete="new-password"
        spellCheck={false}
        translate="no"
        hint={t("doctors.passwordRule", { min: MIN_PASSWORD })}
        error={error}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <Button className="mb-[22px] shrink-0" onClick={() => onChange(generatePassword())}>
        {t("doctors.generate")}
      </Button>
    </div>
  );
}

function CreateDoctorDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (username: string, password: string) => void;
}) {
  const { t } = useTranslation();
  const refresh = useDoctorsRefresh();
  const [form, setForm] = useState({ fullName: "", username: "", password: "", clinic: "" });
  const [problems, setProblems] = useState<Partial<Record<keyof typeof form, string>>>({});
  const create = useMutation({
    mutationFn: () =>
      adminApi.createDoctor({
        full_name: form.fullName.trim(),
        username: form.username.trim(),
        password: form.password,
        clinic: form.clinic.trim() || null,
      }),
    onSuccess: () => {
      refresh();
      onCreated(form.username.trim(), form.password);
      setForm({ fullName: "", username: "", password: "", clinic: "" });
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found: typeof problems = {};
    if (!form.fullName.trim()) found.fullName = t("doctors.nameRequired");
    if (!USERNAME.test(form.username.trim())) found.username = t("patient.usernameRule");
    if (form.password.length < MIN_PASSWORD) found.password = t("doctors.passwordRule", { min: MIN_PASSWORD });
    setProblems(found);
    if (Object.keys(found).length === 0) create.mutate();
  };
  const failure =
    create.error instanceof ApiError && create.error.status === 409
      ? t("patient.usernameTaken")
      : create.isError
        ? t(errorMessage(create.error).key)
        : null;
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={t("doctors.add")}
      description={t("doctors.addBody")}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" form="create-doctor" variant="primary" busy={create.isPending} busyText={t("common.saving")}>
            {t("doctors.create")}
          </Button>
        </>
      }
    >
      <form id="create-doctor" noValidate onSubmit={submit} className="flex flex-col gap-4">
        {failure && <Alert tone="danger">{failure}</Alert>}
        <TextField
          label={t("doctors.fullName")}
          required
          autoComplete="off"
          error={problems.fullName}
          value={form.fullName}
          onChange={(e) => set("fullName")(e.target.value)}
        />
        <TextField
          label={t("doctors.clinic")}
          autoComplete="off"
          hint={t("doctors.clinicHint")}
          maxLength={200}
          value={form.clinic}
          onChange={(e) => set("clinic")(e.target.value)}
        />
        <TextField
          label={t("login.username")}
          required
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          translate="no"
          hint={t("patient.usernameRule")}
          error={problems.username}
          value={form.username}
          onChange={(e) => set("username")(e.target.value)}
        />
        <PasswordField value={form.password} onChange={set("password")} error={problems.password} />
      </form>
    </Dialog>
  );
}

function ClinicDialog({ doctor, onClose }: { doctor: Doctor | null; onClose: () => void }) {
  const { t } = useTranslation();
  const refresh = useDoctorsRefresh();
  const [clinic, setClinic] = useState(doctor?.clinic ?? "");
  const save = useMutation({
    mutationFn: (d: Doctor) => adminApi.setDoctorClinic(d.id, clinic.trim() || null),
    onSuccess: () => {
      refresh();
      onClose();
    },
  });
  return (
    <Dialog
      open={!!doctor}
      onOpenChange={(next) => !next && onClose()}
      title={t("doctors.clinicTitle", { name: doctor?.full_name ?? "" })}
      description={t("doctors.clinicHint")}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" form="clinic-doctor" variant="primary" busy={save.isPending} busyText={t("common.saving")}>
            {t("doctors.clinicSave")}
          </Button>
        </>
      }
    >
      <form
        id="clinic-doctor"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (doctor) save.mutate(doctor);
        }}
        className="flex flex-col gap-3"
      >
        {save.isError && <Alert tone="danger">{t(errorMessage(save.error).key)}</Alert>}
        <TextField label={t("doctors.clinic")} autoComplete="off" maxLength={200} value={clinic} onChange={(e) => setClinic(e.target.value)} />
      </form>
    </Dialog>
  );
}

function BlockDialog({ doctor, onClose }: { doctor: Doctor | null; onClose: () => void }) {
  const { t } = useTranslation();
  const refresh = useDoctorsRefresh();
  const block = useMutation({
    mutationFn: (id: number) => adminApi.setDoctorActive(id, false),
    onSuccess: () => {
      refresh();
      onClose();
    },
  });
  return (
    <Dialog
      open={!!doctor}
      onOpenChange={(next) => !next && onClose()}
      title={t("doctors.blockTitle", { name: doctor?.full_name ?? "" })}
      description={t("doctors.blockBody")}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            variant="danger"
            busy={block.isPending}
            busyText={t("common.saving")}
            onClick={() => doctor && block.mutate(doctor.id)}
          >
            {t("doctors.block")}
          </Button>
        </>
      }
    >
      {block.isError && <Alert tone="danger">{t(errorMessage(block.error).key)}</Alert>}
    </Dialog>
  );
}

function UnblockButton({ doctor }: { doctor: Doctor }) {
  const { t } = useTranslation();
  const refresh = useDoctorsRefresh();
  const unblock = useMutation({ mutationFn: () => adminApi.setDoctorActive(doctor.id, true), onSuccess: refresh });
  return (
    <Button busy={unblock.isPending} busyText={t("common.saving")} onClick={() => unblock.mutate()}>
      {t("doctors.unblock")}
    </Button>
  );
}

function ResetPasswordDialog({
  doctor,
  onClose,
  onDone,
}: {
  doctor: Doctor | null;
  onClose: () => void;
  onDone: (doctor: Doctor, password: string) => void;
}) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<string>();
  const reset = useMutation({
    mutationFn: (d: Doctor) => adminApi.resetDoctorPassword(d.id, password),
    onSuccess: (d) => {
      onDone(d, password);
      setPassword("");
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (password.length < MIN_PASSWORD) return setProblem(t("doctors.passwordRule", { min: MIN_PASSWORD }));
    setProblem(undefined);
    if (doctor) reset.mutate(doctor);
  };
  return (
    <Dialog
      open={!!doctor}
      onOpenChange={(next) => !next && onClose()}
      title={t("doctors.resetTitle", { name: doctor?.full_name ?? "" })}
      description={t("doctors.resetBody")}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" form="reset-doctor" variant="primary" busy={reset.isPending} busyText={t("common.saving")}>
            {t("doctors.resetConfirm")}
          </Button>
        </>
      }
    >
      <form id="reset-doctor" noValidate onSubmit={submit} className="flex flex-col gap-3">
        {reset.isError && <Alert tone="danger">{t(errorMessage(reset.error).key)}</Alert>}
        <PasswordField value={password} onChange={setPassword} error={problem} />
      </form>
    </Dialog>
  );
}
