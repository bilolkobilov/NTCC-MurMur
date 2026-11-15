import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";

import { adminApi } from "../../api/admin";
import { ErrorState, SkeletonRows } from "../../components/ui/States";
import { SecretDialog } from "../../components/ui/SecretDialog";
import { Button } from "../../redesign/components";
import { DoctorProfileView } from "../profile/DoctorProfileView";
import { BlockDialog, EditDoctorDialog, ResetPasswordDialog, UnblockButton } from "./doctorDialogs";

/** The administrator's view of one doctor: the shared profile plus edit, block / unblock and password reset. */
export function DoctorProfilePage() {
  const { t } = useTranslation();
  const id = Number(useParams().doctorId);
  const profile = useQuery({ queryKey: ["admin", "doctor", id], queryFn: () => adminApi.doctor(id), enabled: Number.isInteger(id) });
  const patients = useQuery({ queryKey: ["admin", "doctor", id, "patients"], queryFn: () => adminApi.doctorPatients(id), enabled: Number.isInteger(id) });
  const activity = useQuery({ queryKey: ["admin", "doctor", id, "activity"], queryFn: () => adminApi.doctorActivity(id), enabled: Number.isInteger(id) });
  const [editing, setEditing] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [handOver, setHandOver] = useState<{ username: string; password: string } | null>(null);

  if (profile.isError) return <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />;
  if (!profile.data) return <SkeletonRows rows={4} label={t("common.loading")} />;
  const doctor = profile.data;
  const suspended = doctor.status === "suspended";

  return (
    <>
      <DoctorProfileView
        viewer="admin"
        profile={doctor}
        patients={patients.data ? { kind: "admin", rows: patients.data } : undefined}
        activity={activity.data}
        onEditClinic={() => setEditing(true)}
        onResetPassword={() => setResetting(true)}
        actions={
          <>
            <Button variant="primary" icon="pencil" onClick={() => setEditing(true)}>
              {t("profile.editDetails")}
            </Button>
            {suspended ? (
              <UnblockButton doctor={doctor} />
            ) : (
              <Button variant="danger" icon="ban" onClick={() => setBlocking(true)}>
                {t("doctors.block")}
              </Button>
            )}
          </>
        }
      />
      <EditDoctorDialog key={editing ? `edit-${doctor.id}` : "edit-closed"} doctor={editing ? doctor : null} onClose={() => setEditing(false)} />
      <BlockDialog doctor={blocking ? doctor : null} onClose={() => setBlocking(false)} />
      <ResetPasswordDialog
        key={resetting ? `reset-${doctor.id}` : "reset-closed"}
        doctor={resetting ? doctor : null}
        onClose={() => setResetting(false)}
        onDone={(d, password) => {
          setResetting(false);
          setHandOver({ username: d.username, password });
        }}
      />
      <SecretDialog
        open={!!handOver}
        title={t("doctors.resetDoneTitle")}
        description={t("doctors.handOverBody")}
        secrets={handOver ? [{ label: t("login.username"), value: handOver.username }, { label: t("login.password"), value: handOver.password }] : []}
        acknowledge={t("doctors.handOverDone")}
        onClose={() => setHandOver(null)}
      />
    </>
  );
}
