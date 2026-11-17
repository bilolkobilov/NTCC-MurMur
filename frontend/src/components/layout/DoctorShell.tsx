import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";

import { me } from "../../api/auth";
import { doctorApi } from "../../api/doctor";
import { useSession } from "../../app/session";
import { Icon } from "../../redesign/Icon";
import { AppFrame } from "./AppFrame";

/**
 * The doctor's shell. Only pages that exist are in the navigation. The badge counts the patients whose exam waits for
 * the doctor's review (not all patients: a number there reads as "needs attention").
 */
export function DoctorShell() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const current = useSession();
  const account = useQuery({ queryKey: ["me", current?.token], queryFn: me, enabled: !!current, staleTime: 60_000 });
  const summary = useQuery({ queryKey: ["patients", "summary"], queryFn: doctorApi.patientSummary });

  return (
    <AppFrame
      section={t("shell.suite")}
      roleLabel={t("roles.doctor")}
      nav={[
        {
          to: "/doctor/patients",
          label: t("nav.patients"),
          icon: "users",
          badge: summary.data?.needs_review,
          critical: true,
        },
        { to: "/doctor/profile", label: t("nav.myProfile"), short: t("nav.profileShort"), icon: "user" },
      ]}
      headerChip={
        account.data?.clinic ? (
          <span className="rd-chip rd-chip--clinic" title={t("shell.clinicTitle")}>
            <Icon name="building" />
            {account.data.clinic}
          </span>
        ) : undefined
      }
      menu={[
        { label: t("nav.myProfile"), onSelect: () => navigate("/doctor/profile") },
        { label: t("nav.changePassword"), onSelect: () => navigate("/change-password") },
      ]}
      footerNote={t("shell.note")}
    />
  );
}
