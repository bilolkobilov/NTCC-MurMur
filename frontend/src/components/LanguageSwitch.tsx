import * as Menu from "@radix-ui/react-dropdown-menu";
import { GB, RU, UZ } from "country-flag-icons/react/3x2";
import { useTranslation } from "react-i18next";

import { changeLanguage } from "../i18n";
import { type Language, LANGUAGES } from "../i18n/detect";

/**
 * Language menu: flag + the language's own name ("Oʻzbekcha", "Русский", "English"), never a flag alone — a flag
 * names a country, not a language. Bundled SVG flags (Windows cannot draw flag emoji; the demo has no internet).
 */
const FLAGS: Record<Language, typeof UZ> = { uz: UZ, ru: RU, en: GB };

function Flag({ lang }: { lang: Language }) {
  const Icon = FLAGS[lang];
  return (
    <span aria-hidden="true" className="inline-flex h-3.5 w-5 shrink-0 overflow-hidden rounded-[2px] outline outline-1 -outline-offset-1 outline-black/10">
      <Icon className="h-full w-full" />
    </span>
  );
}

export function LanguageSwitch() {
  const { t, i18n } = useTranslation();
  const current = (LANGUAGES as readonly string[]).includes(i18n.language) ? (i18n.language as Language) : "uz";

  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={`${t("language.label")}: ${t(`language.${current}`)}`}
        className="flex min-h-11 items-center gap-2 rounded-control border border-line bg-surface px-2.5 text-label text-ink-700 transition-[border-color] duration-150 hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-900 data-[state=open]:border-ink-300"
      >
        <Flag lang={current} />
        <span translate="no" className="font-mono text-caption uppercase">
          {current}
        </span>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className="text-ink-500">
          <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align="end"
          sideOffset={6}
          className="z-30 min-w-44 origin-[var(--radix-dropdown-menu-content-transform-origin)] rounded-card border border-line bg-surface p-1 shadow-float data-[state=open]:animate-[dialog-in_160ms_var(--ease-out-strong)]"
        >
          <Menu.RadioGroup value={current} onValueChange={(value) => changeLanguage(value as Language)}>
            {LANGUAGES.map((lang) => (
              <Menu.RadioItem
                key={lang}
                value={lang}
                lang={lang}
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-control px-3 text-body outline-none data-[highlighted]:bg-canvas data-[state=checked]:font-semibold"
              >
                <Flag lang={lang} />
                <span className="flex-1">{t(`language.${lang}`)}</span>
                <Menu.ItemIndicator>
                  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className="text-ink-900">
                    <path d="M3 7.5 6 10.5 11 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </Menu.ItemIndicator>
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
