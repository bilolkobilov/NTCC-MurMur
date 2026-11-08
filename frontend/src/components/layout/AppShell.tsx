import * as Menu from "@radix-ui/react-dropdown-menu";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { useTranslation } from "react-i18next";
import { Link, NavLink, Outlet, useNavigate } from "react-router";

import { me } from "../../api/auth";
import { type Role, session, useSession } from "../../app/session";
import { Logo } from "../brand/Logo";
import { LanguageSwitch } from "../LanguageSwitch";

const NAV: Record<Role, { to: string; key: string; end?: boolean }[]> = {
  doctor: [
    { to: "/doctor", key: "nav.doctorHome", end: true },
    { to: "/doctor/patients", key: "nav.patients" },
  ],
  admin: [
    { to: "/admin", key: "nav.adminOverview", end: true },
    { to: "/admin/doctors", key: "nav.doctors" },
    { to: "/admin/devices", key: "nav.devices" },
    { to: "/admin/audit", key: "nav.audit" },
  ],
  patient: [{ to: "/patient", key: "nav.myResults", end: true }],
};

/** Header (logo, role navigation, language, account menu) + the page below it. */
export function AppShell() {
  const { t } = useTranslation();
  const current = useSession();
  const navigate = useNavigate();
  const account = useQuery({ queryKey: ["me", current?.token], queryFn: me, enabled: !!current, staleTime: 60_000 });

  if (!current) return null; // guards redirect before this renders
  const logOut = () => {
    session.end("loggedOut");
    navigate("/login", { replace: true });
  };

  return (
    <div className="min-h-dvh bg-canvas">
      <a
        href="#main"
        className="sr-only z-30 rounded-control bg-ink-900 px-4 py-2 text-white focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        {t("nav.skip")}
      </a>
      <header className="sticky top-0 z-10 border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5 sm:px-6">
          <Link to="/" className="rounded focus-visible:outline-2 focus-visible:outline-ink-900">
            <Logo />
          </Link>
          <nav aria-label={t("nav.main")} className="order-last -mx-1 flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto">
            {NAV[current.role].map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  clsx(
                    "flex min-h-10 shrink-0 items-center rounded-control px-3 text-label whitespace-nowrap",
                    "focus-visible:outline-2 focus-visible:outline-ink-900",
                    isActive ? "bg-canvas font-semibold text-ink-900" : "text-ink-500 hover:text-ink-900",
                  )
                }
              >
                {t(item.key)}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <LanguageSwitch />
            <Menu.Root>
              <Menu.Trigger
                className="flex min-h-10 items-center gap-2 rounded-control px-2 text-left text-label hover:bg-canvas focus-visible:outline-2 focus-visible:outline-ink-900"
                aria-label={t("nav.account")}
              >
                <span
                  aria-hidden="true"
                  className="grid size-8 place-items-center rounded-full bg-ink-900 text-xs font-semibold text-white"
                >
                  {(account.data?.full_name ?? "?").slice(0, 1).toUpperCase()}
                </span>
                <span className="hidden flex-col leading-tight md:flex">
                  <span className="max-w-40 truncate font-medium">{account.data?.full_name ?? "…"}</span>
                  <span className="text-caption text-ink-500">{t(`roles.${current.role}`)}</span>
                </span>
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Content
                  align="end"
                  sideOffset={6}
                  className="z-20 min-w-48 rounded-card border border-line bg-surface p-1 shadow-float"
                >
                  <Menu.Item
                    onSelect={() => navigate("/change-password")}
                    className="flex min-h-11 cursor-pointer items-center rounded-control px-3 text-label outline-none data-[highlighted]:bg-canvas"
                  >
                    {t("nav.changePassword")}
                  </Menu.Item>
                  <Menu.Separator className="my-1 h-px bg-line" />
                  <Menu.Item
                    onSelect={logOut}
                    className="flex min-h-11 cursor-pointer items-center rounded-control px-3 text-label outline-none data-[highlighted]:bg-canvas"
                  >
                    {t("nav.logOut")}
                  </Menu.Item>
                </Menu.Content>
              </Menu.Portal>
            </Menu.Root>
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-6 outline-none sm:px-6 sm:py-8">
        <Outlet />
      </main>
    </div>
  );
}
