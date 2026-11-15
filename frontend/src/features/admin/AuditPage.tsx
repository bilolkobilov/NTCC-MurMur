import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";

import { AUDIT_PAGE, adminApi } from "../../api/admin";
import { Button } from "../../components/ui/Button";
import { EmptyState, ErrorState, PageHeader, SkeletonRows } from "../../components/ui/States";
import { formatDateTime } from "../../lib/format";

/** Filter groups = action prefixes the backend understands (`?action=patient` → patient.read, patient.update, …). */
const GROUPS = ["patient", "exam", "me", "device"] as const;

/**
 * Audit log: who read or changed patient data, when, and which record — ids only, never names or results.
 * Pages of 50 and the filter live in the URL (?action=exam&page=2), so a reload or a shared link keeps them.
 */
export function AuditPage() {
  const { t, i18n } = useTranslation();
  const [params, setParams] = useSearchParams();
  const action = GROUPS.find((g) => g === params.get("action")) ?? null;
  const page = Math.max(0, Number(params.get("page") ?? "1") - 1) || 0;
  const audit = useQuery({
    queryKey: ["admin", "audit", action, page],
    queryFn: () => adminApi.audit(page, action),
    placeholderData: keepPreviousData, // paging keeps the table in place instead of flashing a skeleton
  });
  const rows = audit.data?.slice(0, AUDIT_PAGE) ?? [];
  const hasOlder = (audit.data?.length ?? 0) > AUDIT_PAGE;

  const go = (next: { action?: string | null; page?: number }) => {
    const query = new URLSearchParams();
    const a = next.action === undefined ? action : next.action;
    const p = next.page ?? 0;
    if (a) query.set("action", a);
    if (p > 0) query.set("page", String(p + 1));
    setParams(query);
  };
  const actionLabel = (code: string) => t(`audit.actions.${code.replaceAll(".", "_")}`, { defaultValue: code });

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={t("audit.title")} meta={t("audit.about")} />

      <div role="group" aria-label={t("audit.filter")} className="mb-4 flex flex-wrap gap-2">
        {[null, ...GROUPS].map((group) => (
          <button
            key={group ?? "all"}
            type="button"
            aria-pressed={action === group}
            onClick={() => go({ action: group, page: 0 })}
            className={clsx(
              "min-h-11 rounded-full border px-4 text-label font-medium transition-[background-color,border-color,color] duration-150",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-900",
              action === group ? "border-ink-900 bg-ink-900 text-white" : "border-line-strong text-ink-700 hover:bg-surface",
            )}
          >
            {t(`audit.groups.${group ?? "all"}`)}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-card border border-line bg-surface">
        {audit.isPending && <SkeletonRows rows={6} label={t("common.loading")} />}
        {audit.isError && !audit.data && <ErrorState error={audit.error} onRetry={() => void audit.refetch()} />}
        {audit.data && rows.length === 0 && <EmptyState title={t("audit.emptyTitle")} body={t("audit.emptyBody")} />}
        {rows.length > 0 && (
          <table className="w-full border-collapse text-left text-label">
            <caption className="sr-only">{t("audit.title")}</caption>
            <thead className="hidden border-b border-line text-caption tracking-wide text-ink-500 uppercase md:table-header-group">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-semibold">{t("audit.when")}</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">{t("audit.who")}</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">{t("audit.what")}</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">{t("audit.record")}</th>
              </tr>
            </thead>
            <tbody className={clsx("divide-y divide-line", audit.isPlaceholderData && "opacity-60")}>
              {rows.map((entry) => (
                <tr key={entry.id} className="grid grid-cols-2 gap-x-4 gap-y-0.5 px-4 py-3 md:table-row md:p-0">
                  <td className="text-ink-500 tabular-nums md:px-4 md:py-2.5">
                    {formatDateTime(entry.created_at, i18n.language)}
                  </td>
                  <td className="text-right md:px-4 md:py-2.5 md:text-left">
                    <span translate="no" className="font-mono text-ink-900">
                      {entry.username ?? "—"}
                    </span>
                    {entry.role && <span className="text-ink-500"> · {t(`roles.${entry.role}`)}</span>}
                  </td>
                  <td className="text-ink-900 md:px-4 md:py-2.5">{actionLabel(entry.action)}</td>
                  <td className="text-right text-ink-500 md:px-4 md:py-2.5 md:text-left">
                    {t(`audit.objects.${entry.object_type}`, { defaultValue: entry.object_type })}
                    {entry.object_id !== null && <span className="font-mono tabular-nums"> #{entry.object_id}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <nav aria-label={t("audit.pages")} className="mt-4 flex items-center justify-between gap-3">
        <Button disabled={page === 0} onClick={() => go({ page: page - 1 })}>
          ← {t("audit.newer")}
        </Button>
        <span className="text-label text-ink-500 tabular-nums">{t("audit.page", { page: page + 1 })}</span>
        <Button disabled={!hasOlder} onClick={() => go({ page: page + 1 })}>
          {t("audit.older")} →
        </Button>
      </nav>
    </div>
  );
}
