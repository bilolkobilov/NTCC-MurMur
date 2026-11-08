import { useTranslation } from "react-i18next";
import { Link } from "react-router";

function StatusPage({ title, body }: { title: string; body?: string }) {
  const { t } = useTranslation();
  return (
    <section className="mx-auto max-w-lg py-16 text-center">
      <h1 className="text-headline font-semibold">{title}</h1>
      {body && <p className="mt-2 text-ink-500">{body}</p>}
      <Link
        to="/"
        className="mt-6 inline-flex min-h-11 items-center rounded-control border border-line-strong bg-surface px-4 font-semibold hover:bg-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-900"
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
