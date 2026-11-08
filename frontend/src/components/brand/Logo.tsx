import { useTranslation } from "react-i18next";

/** Heart-wave mark (signal crimson) + wordmark. The mark is the only other place crimson appears besides traces. */
export function Logo({ size = "md" }: { size?: "md" | "lg" }) {
  const { t } = useTranslation();
  const large = size === "lg";
  return (
    <span className="inline-flex items-center gap-2 font-semibold tracking-tight text-ink-900">
      <svg
        width={large ? 34 : 26}
        height={large ? 24 : 18}
        viewBox="0 0 26 18"
        aria-hidden="true"
        className="shrink-0"
      >
        <path
          d="M1 9h6l2-6 3 12 3-9 2 3h8"
          fill="none"
          stroke="var(--color-signal)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className={large ? "text-2xl" : "text-lg"}>{t("app.name")}</span>
    </span>
  );
}
