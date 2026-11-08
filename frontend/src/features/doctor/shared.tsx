import { clsx } from "clsx";
import { useTranslation } from "react-i18next";

import type { Point } from "../../api/doctor";

/** Patient record number, e.g. "№ 012" — the clinical identity on lists instead of an avatar. */
export function RecordNo({ id, className }: { id: number; className?: string }) {
  return (
    <span translate="no" className={clsx("font-mono text-caption text-ink-500 tabular-nums", className)}>
      № {String(id).padStart(3, "0")}
    </span>
  );
}

/** Auscultation point: code (never translated) + the valve name in the user's language. */
export function PointLabel({ point, short = false }: { point: Point; short?: boolean }) {
  const { t } = useTranslation();
  return (
    <span className="whitespace-nowrap">
      <span translate="no" className="font-mono text-label font-medium">
        {point}
      </span>
      {!short && <span className="text-ink-500"> · {t(`exam.point.${point}`)}</span>}
    </span>
  );
}

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
