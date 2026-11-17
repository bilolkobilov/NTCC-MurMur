import * as Menu from "@radix-ui/react-dropdown-menu";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet, useNavigate } from "react-router";

import { me } from "../../api/auth";
import { session, useSession } from "../../app/session";
import { initials } from "../../lib/format";
import { BrandMark, CountBadge } from "../../redesign/components";
import { Icon, type IconName } from "../../redesign/Icon";
import { LanguageSwitch } from "../LanguageSwitch";
import { SkeletonRows } from "../ui/States";

export type FrameNavItem = {
  to: string;
  label: string;
  /** Shorter label for the phone tab bar (defaults to `label`). */
  short?: string;
  icon: IconName;
  end?: boolean;
  badge?: number;
  critical?: boolean;
};

type Props = {
  /** Small caption above the navigation ("Clinical suite", "Administration"). */
  section: string;
  nav: FrameNavItem[];
  roleLabel: string;
  /** Chip in the header next to the account (clinic, "admin view"); hidden on phones. */
  headerChip?: ReactNode;
  menu: { label: string; onSelect: () => void }[];
  footerNote: string;
};

/**
 * The doctor's and the administrator's frame. Wide screens: a full-height sidebar, a header with the account menu,
 * the page and a footer. Below 900 px the sidebar becomes a bottom tab bar and the header carries the logo, so every
 * page has the whole width of a phone (owner, 2026-11-17: the doctor uses a phone as much as a laptop).
 */
export function AppFrame({ section, nav, roleLabel, headerChip, menu, footerNote }: Props) {
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
          <div className="rd-cap rd-shell__section">{section}</div>
          {nav.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className="rd-nav-item">
              <Icon name={item.icon} />
              <span style={{ flex: 1 }}>{item.label}</span>
              {item.badge ? <CountBadge value={item.badge} critical={item.critical} /> : null}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="rd-shell__col">
        <header className="rd-shell__header">
          <span className="rd-shell__mobilebrand">
            <BrandMark size={32} />
            <span className="rd-wordmark">MurMur</span>
          </span>
          <span className="rd-shell__headtools">
            <LanguageSwitch />
            {headerChip && <span className="rd-hide-sm">{headerChip}</span>}
            <Menu.Root>
              <Menu.Trigger className="rd-userbtn" aria-label={t("nav.account")}>
                <span className="rd-avatar" aria-hidden="true">
                  {initials(name)}
                </span>
                <span className="rd-userbtn__text rd-hide-sm">
                  <span className="rd-label">{name}</span>
                  <span className="rd-sm">{roleLabel}</span>
                </span>
                <Icon name="chevronDown" size="sm" />
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Content align="end" sideOffset={6} className="rd-menu">
                  <div className="rd-menu-who">
                    <span className="rd-label">{name}</span>
                    <span className="rd-sm">{roleLabel}</span>
                  </div>
                  {menu.map((item) => (
                    <Menu.Item key={item.label} onSelect={item.onSelect} className="rd-menu-item">
                      {item.label}
                    </Menu.Item>
                  ))}
                  <Menu.Separator className="rd-menu-sep" />
                  <Menu.Item onSelect={logOut} className="rd-menu-item">
                    {t("nav.logOut")}
                  </Menu.Item>
                </Menu.Content>
              </Menu.Portal>
            </Menu.Root>
          </span>
        </header>

        <main id="main" tabIndex={-1} className="rd-shell__main">
          <Suspense fallback={<SkeletonRows rows={4} label={t("common.loading")} />}>
            <Outlet />
          </Suspense>
        </main>

        <footer className="rd-shell__footer">
          <span className="rd-sm">{t("shell.rights")}</span>
          <span className="rd-sm">{footerNote}</span>
        </footer>
      </div>

      <nav aria-label={t("nav.tabBar")} className="rd-tabbar">
        {nav.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className="rd-tabbar__item">
            <span className="rd-tabbar__icon">
              <Icon name={item.icon} />
              {item.badge ? <span className="rd-tabbar__badge">{item.badge}</span> : null}
            </span>
            <span>{item.short ?? item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
