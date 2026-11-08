import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { ChartTrace } from "../brand/ChartTrace";
import { Logo } from "../brand/Logo";
import { LanguageSwitch } from "../LanguageSwitch";

/**
 * Login / change-password frame. Laptop: chart-paper panel left, form right. Phone: a strip of chart paper on top.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="grid min-h-dvh grid-rows-[auto_1fr] bg-surface lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:grid-rows-1">
      <aside className="relative flex flex-col justify-between lg:border-r lg:border-line">
        <div className="flex items-center justify-between px-5 pt-5 sm:px-8 sm:pt-7">
          <Logo size="lg" />
          <div className="lg:hidden">
            <LanguageSwitch />
          </div>
        </div>
        <div className="my-5 lg:my-0">
          <ChartTrace seconds={4} className="h-28 w-full border-y border-grid-major lg:h-56" />
        </div>
        <div className="hidden px-8 pb-8 lg:block">
          <p className="text-display font-semibold">{t("app.tagline")}</p>
          <p className="mt-3 max-w-md text-ink-500">{t("app.pitch")}</p>
          <p className="mt-6 font-mono text-caption text-ink-500">{t("app.disclaimer")}</p>
        </div>
      </aside>
      <section className="flex flex-col px-5 py-6 sm:px-8 lg:py-7">
        <div className="hidden justify-end lg:flex">
          <LanguageSwitch />
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-start py-2 lg:justify-center lg:py-4">{children}</div>
        <p className="mt-4 text-center font-mono text-caption text-ink-500 lg:hidden">{t("app.disclaimer")}</p>
      </section>
    </div>
  );
}
