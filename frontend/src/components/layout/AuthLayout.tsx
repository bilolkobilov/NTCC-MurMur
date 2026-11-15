import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { AuthLogo } from "../auth/AuthControls";
import { LanguageSwitch } from "../LanguageSwitch";

/**
 * Sign-in / change-password frame (redesign frames #7–#16): logo on top, one centred card on the light canvas.
 * Desktop widths only for now; responsive behaviour comes with the rest of the redesign.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-dvh flex-col bg-auth-canvas text-body text-auth-ink">
      <header className="flex items-center justify-between px-8 py-4">
        <AuthLogo name={t("app.name")} />
        <LanguageSwitch />
      </header>
      <main className="flex flex-1 items-center justify-center px-5 py-6">
        <div className="flex w-[420px] max-w-full flex-col gap-6 rounded-card border border-auth-border bg-surface p-8">
          {children}
        </div>
      </main>
      <footer className="px-6 pb-6 text-center font-mono text-caption text-auth-ink-3">{t("app.disclaimer")}</footer>
    </div>
  );
}
