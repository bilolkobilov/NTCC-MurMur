import * as Menu from "@radix-ui/react-dropdown-menu";
import { useQuery } from "@tanstack/react-query";
import { Suspense } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet, useNavigate } from "react-router";

import { adminApi } from "../../api/admin";
import { me } from "../../api/auth";
import { session, useSession } from "../../app/session";
import { BrandMark, CountBadge } from "../../redesign/components";
import { Icon, type IconName } from "../../redesign/Icon";
import { LanguageSwitch } from "../LanguageSwitch";
import { SkeletonRows } from "../ui/States";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");

const NAV: { to: string; key: string; icon: IconName; end?: boolean }[] = [
  { to: "/admin", key: "nav.adminOverview", icon: "layout", end: true },
  { to: "/admin/doctors", key: "nav.doctors", icon: "users" },
  { to: "/admin/devices", key: "nav.devices", icon: "radio" },
  { to: "/admin/audit", key: "nav.audit", icon: "clipboard" },
];

/** The administrator's shell: the same frame as the doctor's (sidebar, header with account menu, footer). */
export function AdminShell() {
  const { t } = useTranslation();
  const current = useSession();
  const navigate = useNavigate();
  const account = useQuery({ queryKey: ["me", current?.token], queryFn: me, enabled: !!current, staleTime: 60_000 });
  const stats = useQuery({ queryKey: ["admin", "stats"], queryFn: adminApi.stats });

  if (!current) return null; // guards redirect before this renders
  const logOut = () => {
    session.end("loggedOut");
    navigate("/login", { replace: true });
  };
  const name = account.data?.full_name ?? "…";

  return (
    <div id="page-top" className="rd-shell">
      <a href="#main" className="rd-skip">
        {t("nav.skip")}
      </a>
      <aside aria-label={t("nav.main")} className="rd-shell__side">
        <div className="rd-shell__brand">
          <BrandMark />
          <span className="rd-shell__brandtext">
            <span className="rd-wordmark">MurMur</span>
            <span className="rd-cap">{t("shell.tagline")}</span>
          </span>
        </div>
        <nav aria-label={t("nav.main")} className="rd-shell__nav">
          <div className="rd-cap rd-shell__section">{t("shell.administration")}</div>
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className="rd-nav-item">
              <Icon name={item.icon} />
              <span style={{ flex: 1 }}>{t(item.key)}</span>
              {item.to === "/admin/doctors" && stats.data && <CountBadge value={stats.data.doctors_total} />}
              {item.to === "/admin/devices" && stats.data && <CountBadge value={stats.data.devices_total} />}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="rd-shell__col">
        <header className="rd-shell__header">
          <LanguageSwitch />
          <span className="rd-chip rd-chip--clinic">
            <Icon name="shield" />
            {t("shell.adminView")}
          </span>
          <Menu.Root>
            <Menu.Trigger className="rd-userbtn" aria-label={t("nav.account")}>
              <span className="rd-avatar" aria-hidden="true">
                {initials(name)}
              </span>
              <span className="rd-userbtn__text">
                <span className="rd-label">{name}</span>
                <span className="rd-sm">{t("roles.admin")}</span>
              </span>
              <Icon name="chevronDown" size="sm" />
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Content align="end" sideOffset={6} className="rd-menu">
                <Menu.Item onSelect={() => navigate("/change-password")} className="rd-menu-item">
                  {t("nav.changePassword")}
                </Menu.Item>
                <Menu.Separator className="rd-menu-sep" />
                <Menu.Item onSelect={logOut} className="rd-menu-item">
                  {t("nav.logOut")}
                </Menu.Item>
              </Menu.Content>
            </Menu.Portal>
          </Menu.Root>
        </header>

        <main id="main" tabIndex={-1} className="rd-shell__main">
          <Suspense fallback={<SkeletonRows rows={4} label={t("common.loading")} />}>
            <Outlet />
          </Suspense>
        </main>

        <footer className="rd-shell__footer">
          <div className="rd-shell__footrow">
            <span className="rd-sm">{t("shell.rights")}</span>
            <span className="rd-sm">{t("shell.adminNote")}</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
