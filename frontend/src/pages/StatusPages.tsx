import { useTranslation } from "react-i18next";
import { Link } from "react-router";

function StatusPage({ title, body }: { title: string; body?: string }) {
  const { t } = useTranslation();
  return (
    <section className="mx-auto max-w-lg py-16 text-center">
      <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
      {body && <p className="mt-2 text-ink-500 text-pretty">{body}</p>}
      <Link
        to="/"
        className="mt-6 inline-flex min-h-10 items-center rounded-lg border border-line-strong bg-surface px-4 text-sm font-semibold hover:bg-canvas"
      >
        {t("pages.goHome")}
      </Link>
    </section>
  );
}

export function NotAvailablePage() {
  const { t } = useTranslation();
  return <StatusPage title={t("pages.notAvailableTitle")} body={t("pages.notAvailableBody")} />;
}

export function NotFoundPage() {
  const { t } = useTranslation();
  return <StatusPage title={t("pages.notFoundTitle")} />;
}

/** Honest placeholder for a page that a later task builds — never a fake screen. */
export function NotBuiltPage() {
  const { t } = useTranslation();
  return <StatusPage title={t("pages.notBuiltTitle")} body={t("pages.notBuiltBody")} />;
}
