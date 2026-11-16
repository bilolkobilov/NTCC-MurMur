import * as Menu from "@radix-ui/react-dropdown-menu";
import { useQuery } from "@tanstack/react-query";
import { Suspense } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet, useNavigate } from "react-router";

import { me } from "../../api/auth";
import { session, useSession } from "../../app/session";
import { initials } from "../../lib/format";
import { Avatar, BrandMark } from "../../redesign/components";
import { Icon, type IconName } from "../../redesign/Icon";
import { LanguageSwitch } from "../LanguageSwitch";
import { SkeletonRows } from "../ui/States";
import "./patient.css";

const TABS: { to: string; key: string; icon: IconName; end?: boolean }[] = [
  { to: "/patient", key: "portal.nav.results", icon: "clipboard", end: true },
  { to: "/patient/profile", key: "portal.nav.profile", icon: "user" },
];

/**
 * The patient's shell (designs "Patient results" and "Patient profile"): header with Results / Profile on a wide
 * screen, the same two as a tab bar at the bottom of a phone. No sidebar: a patient has two pages.
 */
export function PatientShell() {
  const { t } = useTranslation();
  const current = useSession();
  const navigate = useNavigate();
  const account = useQuery({ queryKey: ["me", current?.token], queryFn: me, enabled: !!current, staleTime: 60_000 });

  if (!current) return null; // guards redirect before this renders
  const logOut = () => {
    session.end("loggedOut");
    navigate("/login", { replace: true });
  };
  const name = account.data?.full_name ?? "…";

  return (
    <div className="pt-shell">
      <a href="#main" className="rd-skip">
        {t("nav.skip")}
      </a>
      <aside className="pt-side">
        <NavLink to="/patient" className="pt-brand" aria-label={t("portal.nav.main")}>
          <BrandMark />
          <span className="pt-brand__text">
            <span className="rd-wordmark">MurMur</span>
            <span className="rd-sm">{t("portal.nav.main")}</span>
          </span>
        </NavLink>
        <nav aria-label={t("nav.main")} className="pt-nav">
          {TABS.map((tab) => (
            <NavLink key={tab.to} to={tab.to} end={tab.end} className="pt-nav__link">
              <Icon name={tab.icon} />
              {t(tab.key)}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="pt-col">
      <header className="pt-header">
        <div className="pt-header__row">
          <NavLink to="/patient" className="pt-brand pt-brand--mobile" aria-label={t("portal.nav.main")}>
            <BrandMark size={36} />
            <span className="rd-wordmark">MurMur</span>
          </NavLink>
          <div className="pt-header__end">
            <LanguageSwitch />
            <Menu.Root>
              <Menu.Trigger className="rd-userbtn" aria-label={t("nav.account")}>
                <Avatar initials={initials(name)} />
                <span className="rd-userbtn__text pt-hide-sm">
                  <span className="rd-label">{name}</span>
                  <span className="rd-sm">{t("roles.patient")}</span>
                </span>
                <Icon name="chevronDown" size="sm" />
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Content align="end" sideOffset={6} className="rd-menu">
                  <Menu.Item onSelect={() => navigate("/patient/profile")} className="rd-menu-item">
                    {t("portal.nav.profile")}
                  </Menu.Item>
                  <Menu.Item onSelect={() => navigate("/change-password")} className="rd-menu-item">
                    {t("nav.changePassword")}
                  </Menu.Item>
                  <Menu.Separator className="rd-menu-sep" />
                  <Menu.Item onSelect={logOut} className="rd-menu-item">
                    {t("portal.nav.signOut")}
                  </Menu.Item>
                </Menu.Content>
              </Menu.Portal>
            </Menu.Root>
          </div>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="pt-main">
        <Suspense fallback={<SkeletonRows rows={4} label={t("common.loading")} />}>
          <Outlet />
        </Suspense>
      </main>

      <footer className="pt-footer">
        <p className="rd-sm">{t("portal.disclaimer")}</p>
      </footer>
      </div>

      <nav aria-label={t("nav.main")} className="pt-tabs">
        {TABS.map((tab) => (
          <NavLink key={tab.to} to={tab.to} end={tab.end} className="pt-tabs__link">
            <Icon name={tab.icon} size="lg" />
            {t(tab.key)}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
