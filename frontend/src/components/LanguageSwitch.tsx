import { clsx } from "clsx";
import { useTranslation } from "react-i18next";

import { changeLanguage } from "../i18n";
import { type Language, LANGUAGES } from "../i18n/detect";

/** UZ / RU / EN. Each button is labelled with the language's own name for screen readers. */
export function LanguageSwitch() {
  const { t, i18n } = useTranslation();
  return (
    <div role="group" aria-label={t("language.label")} className="flex gap-0.5 rounded-lg bg-canvas p-0.5">
      {LANGUAGES.map((lang: Language) => {
        const active = i18n.language === lang;
        return (
          <button
            key={lang}
            type="button"
            lang={lang}
            aria-pressed={active}
            aria-label={t(`language.${lang}`)}
            onClick={() => changeLanguage(lang)}
            className={clsx(
              "relative min-h-8 min-w-9 rounded-md px-2 font-mono text-xs uppercase transition-colors",
              "focus-visible:outline-2 focus-visible:outline-ink-900",
              "after:absolute after:-inset-1 after:content-['']", // ≥ 40 px hit area
              active ? "bg-ink-900 text-white" : "text-ink-500 hover:text-ink-900",
            )}
          >
            {lang}
          </button>
        );
      })}
    </div>
  );
}
