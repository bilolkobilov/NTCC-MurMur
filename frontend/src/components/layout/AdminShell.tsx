import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";

import { adminApi } from "../../api/admin";
import { Icon } from "../../redesign/Icon";
import { AppFrame } from "./AppFrame";

/** The administrator's shell: the same frame as the doctor's. */
export function AdminShell() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const stats = useQuery({ queryKey: ["admin", "stats"], queryFn: adminApi.stats });

  return (
    <AppFrame
      section={t("shell.administration")}
      roleLabel={t("roles.admin")}
      nav={[
        { to: "/admin", label: t("nav.adminOverview"), short: t("nav.overviewShort"), icon: "layout", end: true },
        { to: "/admin/doctors", label: t("nav.doctors"), icon: "users", badge: stats.data?.doctors_total },
        { to: "/admin/devices", label: t("nav.devices"), icon: "radio", badge: stats.data?.devices_total },
        { to: "/admin/audit", label: t("nav.audit"), short: t("nav.auditShort"), icon: "clipboard" },
      ]}
      headerChip={
        <span className="rd-chip rd-chip--clinic">
          <Icon name="shield" />
          {t("shell.adminView")}
        </span>
      }
      menu={[{ label: t("nav.changePassword"), onSelect: () => navigate("/change-password") }]}
      footerNote={t("shell.adminNote")}
    />
  );
}
