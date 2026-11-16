import * as Menu from "@radix-ui/react-dropdown-menu";
import { useQuery } from "@tanstack/react-query";
import { Suspense } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet, useNavigate } from "react-router";

import { me } from "../../api/auth";
import { doctorApi } from "../../api/doctor";
import { session, useSession } from "../../app/session";
import { BrandMark, CountBadge } from "../../redesign/components";
import { Icon } from "../../redesign/Icon";
import { LanguageSwitch } from "../LanguageSwitch";
import { SkeletonRows } from "../ui/States";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");

/**
 * The doctor's shell (design "Desktop shell 1440"): full-height sidebar, a right-aligned header with the account
 * menu, the page, and a footer. Admin and patient have their own shells.
 * The sidebar lists only the pages that exist; "New recording", "Analysis results" and "Clinical reports" have none.
 */
export function DoctorShell() {
  const { t } = useTranslation();
  const current = useSession();
  const navigate = useNavigate();
  const account = useQuery({ queryKey: ["me", current?.token], queryFn: me, enabled: !!current, staleTime: 60_000 });
  const summary = useQuery({ queryKey: ["patients", "summary"], queryFn: doctorApi.patientSummary });

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
          <div className="rd-cap rd-shell__section">{t("shell.suite")}</div>
          <NavLink to="/doctor/patients" className="rd-nav-item">
            <Icon name="users" />
            <span style={{ flex: 1 }}>{t("nav.patients")}</span>
            {summary.data && <CountBadge value={summary.data.total} />}
          </NavLink>
          <div className="rd-cap rd-shell__section">{t("shell.account")}</div>
          <NavLink to="/doctor/profile" className="rd-nav-item">
            <Icon name="user" />
            <span style={{ flex: 1 }}>{t("nav.myProfile")}</span>
          </NavLink>
        </nav>
      </aside>

      <div className="rd-shell__col">
        <header className="rd-shell__header">
          <LanguageSwitch />
          {account.data?.clinic && (
            <span className="rd-chip rd-chip--clinic" title={t("shell.clinicTitle")}>
              <Icon name="building" />
              {account.data.clinic}
            </span>
          )}
          <Menu.Root>
            <Menu.Trigger className="rd-userbtn" aria-label={t("nav.account")}>
              <span className="rd-avatar" aria-hidden="true">
                {initials(name)}
              </span>
              <span className="rd-userbtn__text">
                <span className="rd-label">{name}</span>
                <span className="rd-sm">{t("roles.doctor")}</span>
              </span>
              <Icon name="chevronDown" size="sm" />
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Content align="end" sideOffset={6} className="rd-menu">
                <Menu.Item onSelect={() => navigate("/doctor/profile")} className="rd-menu-item">
                  {t("nav.myProfile")}
                </Menu.Item>
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
            <nav aria-label={t("shell.footerNav")} className="rd-shell__links">
              <a href="#page-top">{t("shell.privacy")}</a>
              <a href="#page-top">{t("shell.terms")}</a>
              <a href="#page-top">{t("shell.accessibility")}</a>
              <a href="#page-top">{t("shell.support")}</a>
            </nav>
          </div>
          <span className="rd-sm">{t("shell.note")}</span>
        </footer>
      </div>
    </div>
  );
}
