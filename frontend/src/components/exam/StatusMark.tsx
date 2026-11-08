import { clsx } from "clsx";
import { useTranslation } from "react-i18next";

import type { ExamStatus } from "../../api/doctor";

/**
 * The signature in miniature: a 36×12 trace whose shape tells the exam's state, always next to the word.
 * waiting = flat dotted line · recording = live trace (signal red) · uploaded = trace being read (ink)
 * analyzed = trace + finding colour ("needs your review") · reviewed = trace in clear · failed = broken line.
 */
const TRACE = "M0 6h7l2-4 2.5 8 2-6 1.5 2H22l2-4 2.5 8 2-6 1.5 2H36";

const STYLE: Record<ExamStatus, { stroke: string; text: string; dash?: string; broken?: boolean }> = {
  waiting: { stroke: "var(--color-ink-300)", text: "text-ink-500", dash: "1.5 2.5" },
  recording: { stroke: "var(--color-signal)", text: "text-signal" },
  uploaded: { stroke: "var(--color-ink-500)", text: "text-ink-700" },
  analyzed: { stroke: "var(--color-finding)", text: "text-finding" },
  reviewed: { stroke: "var(--color-clear)", text: "text-clear" },
  failed: { stroke: "var(--color-danger)", text: "text-danger", broken: true },
};

/** `label` replaces the default word, e.g. the admin's neutral "Awaiting the doctor's review". */
export function StatusMark({ status, compact = false, label }: { status: ExamStatus; compact?: boolean; label?: string }) {
  const { t } = useTranslation();
  const style = STYLE[status];
  return (
    <span className={clsx("inline-flex items-center gap-2 text-label font-medium whitespace-nowrap", style.text)}>
      <svg width="36" height="12" viewBox="0 0 36 12" aria-hidden="true" className="shrink-0 overflow-visible">
        {status === "waiting" ? (
          <path d="M0 6H36" stroke={style.stroke} strokeWidth="1.5" strokeDasharray={style.dash} fill="none" />
        ) : style.broken ? (
          <path d="M0 6h7l2-4 2.5 8M20 6h2l2-4 2.5 8 2-6 1.5 2H36" stroke={style.stroke} strokeWidth="1.5" fill="none" />
        ) : (
          <path d={TRACE} stroke={style.stroke} strokeWidth="1.5" fill="none" strokeLinejoin="round" />
        )}
      </svg>
      <span className={compact ? "sr-only" : undefined}>{label ?? t(`exam.status.${status}`)}</span>
    </span>
  );
}
