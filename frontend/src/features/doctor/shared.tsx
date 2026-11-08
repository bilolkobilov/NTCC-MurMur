import { clsx } from "clsx";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router";

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

/**
 * A one-time message passed with navigation (e.g. "Patient saved"): read once, then removed from the browser history
 * entry, so a reload or the Back button does not show it again.
 */
export function useOneTimeState<T>(key: string): T | undefined {
  const location = useLocation();
  const navigate = useNavigate();
  const [value] = useState(() => (location.state as Record<string, T> | null)?.[key]);
  useEffect(() => {
    if (value !== undefined) navigate(location.pathname + location.search, { replace: true, state: null });
    // run once on arrival
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return value;
}
