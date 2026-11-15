import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";

import { adminApi, type Doctor } from "../../api/admin";
import { errorMessage } from "../../api/client";
import { Alert } from "../../components/ui/Alert";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { TextField } from "../../components/ui/TextField";
import { MIN_PASSWORD, PasswordField } from "./doctorFields";

/** After any change to a doctor: the list, the open profile and the admin counts are stale. */
export function useDoctorsRefresh() {
  const queryClient = useQueryClient();
  return () => {
    for (const key of [["admin", "doctors"], ["admin", "doctor"], ["admin", "stats"]]) {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  };
}

/** Change the doctor's name and where they work. A blank clinic clears it. */
export function EditDoctorDialog({ doctor, onClose }: { doctor: Doctor | null; onClose: () => void }) {
  const { t } = useTranslation();
  const refresh = useDoctorsRefresh();
  const [fullName, setFullName] = useState(doctor?.full_name ?? "");
  const [clinic, setClinic] = useState(doctor?.clinic ?? "");
  const [problem, setProblem] = useState<string>();
  const save = useMutation({
    mutationFn: (d: Doctor) => adminApi.updateDoctor(d.id, { full_name: fullName.trim(), clinic: clinic.trim() || null }),
    onSuccess: () => {
      refresh();
      onClose();
    },
  });
  return (
    <Dialog
      open={!!doctor}
      onOpenChange={(next) => !next && onClose()}
      title={t("profile.editTitle", { name: doctor?.full_name ?? "" })}
      description={t("doctors.clinicHint")}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" form="edit-doctor" variant="primary" busy={save.isPending} busyText={t("common.saving")}>
            {t("doctors.clinicSave")}
          </Button>
        </>
      }
    >
      <form
        id="edit-doctor"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!fullName.trim()) return setProblem(t("doctors.nameRequired"));
          setProblem(undefined);
          if (doctor) save.mutate(doctor);
        }}
        className="flex flex-col gap-3"
      >
        {save.isError && <Alert tone="danger">{t(errorMessage(save.error).key)}</Alert>}
        <TextField
          label={t("doctors.fullName")}
          required
          autoComplete="off"
          maxLength={200}
          error={problem}
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
        <TextField label={t("doctors.clinic")} autoComplete="off" maxLength={200} value={clinic} onChange={(e) => setClinic(e.target.value)} />
      </form>
    </Dialog>
  );
}

export function BlockDialog({ doctor, onClose }: { doctor: Doctor | null; onClose: () => void }) {
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
          <Button variant="danger" busy={block.isPending} busyText={t("common.saving")} onClick={() => doctor && block.mutate(doctor.id)}>
            {t("doctors.block")}
          </Button>
        </>
      }
    >
      {block.isError && <Alert tone="danger">{t(errorMessage(block.error).key)}</Alert>}
    </Dialog>
  );
}

export function UnblockButton({ doctor }: { doctor: Doctor }) {
  const { t } = useTranslation();
  const refresh = useDoctorsRefresh();
  const unblock = useMutation({ mutationFn: () => adminApi.setDoctorActive(doctor.id, true), onSuccess: refresh });
  return (
    <Button busy={unblock.isPending} busyText={t("common.saving")} onClick={() => unblock.mutate()}>
      {t("doctors.unblock")}
    </Button>
  );
}

export function ResetPasswordDialog({
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
