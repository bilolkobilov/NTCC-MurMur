import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { errorMessage } from "../../api/client";
import { Button } from "./Button";

/** Empty state: what this is + why it is empty + one action. A flat line on chart paper — "nothing recorded yet". */
export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <svg width="120" height="24" viewBox="0 0 120 24" aria-hidden="true" className="chart-grid rounded-[4px]">
        <path d="M0 12H120" stroke="var(--color-ink-300)" strokeWidth="1.5" strokeDasharray="2 3" />
      </svg>
      <h3 className="mt-4 text-title font-semibold">{title}</h3>
      <p className="mt-1 max-w-sm text-ink-500">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Load failure: what happened (in the user's language) + retry. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useTranslation();
  const message = errorMessage(error);
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <p className="max-w-sm text-danger">{t(message.key, message.values ?? {})}</p>
      <Button onClick={onRetry}>{t("common.retry")}</Button>
    </div>
  );
}

/** Placeholder rows while a list loads: same height as real rows, so nothing jumps when data arrives. */
export function SkeletonRows({ rows = 5, label }: { rows?: number; label: string }) {
  return (
    <ul aria-busy="true" aria-label={label} className="divide-y divide-line">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex min-h-16 items-center gap-4 px-4">
          <span className="h-3 w-12 rounded bg-line motion-safe:animate-[skeleton-pulse_1.6s_ease-in-out_infinite]" />
          <span className="h-3 flex-1 rounded bg-line motion-safe:animate-[skeleton-pulse_1.6s_ease-in-out_infinite]" />
          <span className="hidden h-3 w-24 rounded bg-line sm:block motion-safe:animate-[skeleton-pulse_1.6s_ease-in-out_infinite]" />
        </li>
      ))}
    </ul>
  );
}

/** Page title row: title (+ meta line) on the left, actions on the right; stacks on phones. */
export function PageHeader({ title, meta, actions }: { title: ReactNode; meta?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-headline font-semibold">{title}</h1>
        {meta && <div className="mt-1 text-ink-500">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** A surface with a hairline — the only "card" in the system (borders-only depth). */
export function Panel({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-card border border-line bg-surface">
      {(title || actions) && (
        <div className="flex min-h-12 items-center justify-between gap-3 border-b border-line px-4">
          {title && <h2 className="text-label font-semibold tracking-wide text-ink-700 uppercase">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}
