import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { AuthLogo } from "../auth/AuthControls";
import { LanguageSwitch } from "../LanguageSwitch";

/**
 * Sign-in / change-password frame (redesign frames #7–#16): logo on top, one centred card on the light canvas.
 * Phone-first: 16 px gutters and a full-width card on a phone, the 420 px card on wider screens.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-dvh flex-col bg-canvas text-body text-ink-900">
      <header className="flex items-center justify-between px-4 py-4 sm:px-8">
        <AuthLogo name={t("app.name")} />
        <LanguageSwitch />
      </header>
      <main className="flex flex-1 items-center justify-center px-5 py-6">
        <div className="flex w-[420px] max-w-full flex-col gap-6 rounded-card border border-line bg-surface p-5 sm:p-8">
          {children}
        </div>
      </main>
      <footer className="px-6 pb-6 text-center font-mono text-caption text-ink-500">{t("app.disclaimer")}</footer>
    </div>
  );
}
