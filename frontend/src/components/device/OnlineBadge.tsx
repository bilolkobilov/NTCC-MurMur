import { clsx } from "clsx";
import { useTranslation } from "react-i18next";

/** Online dot + words. Colour is never the only signal. */
export function OnlineBadge({ online }: { online: boolean }) {
  const { t } = useTranslation();
  return (
    <span className={clsx("inline-flex items-center gap-1.5 text-label", online ? "text-clear" : "text-ink-500")}>
      <span
        aria-hidden="true"
        className={clsx("size-2 rounded-full", online ? "bg-clear" : "border border-ink-300 bg-transparent")}
      />
      {online ? t("device.online") : t("device.offline")}
    </span>
  );
}
