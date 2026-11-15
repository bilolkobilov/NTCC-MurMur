import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "./Button";
import { Dialog } from "./Dialog";

type Secret = { label: string; value: string };

/**
 * Shows one-time secrets (temporary password, device key) exactly once.
 * Cannot be dismissed with Esc or a click outside — only the acknowledgement button closes it.
 */
export function SecretDialog({
  open,
  title,
  description,
  secrets,
  acknowledge,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  secrets: Secret[];
  acknowledge: string;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      dismissible={false}
      title={title}
      description={description}
      footer={
        <Button variant="primary" onClick={onClose}>
          {acknowledge}
        </Button>
      }
    >
      <dl className="flex flex-col gap-3">
        {secrets.map((secret) => (
          <SecretRow key={secret.label} {...secret} />
        ))}
      </dl>
    </Dialog>
  );
}

/** One copyable secret; also used inline by the "add doctor" page. */
export function SecretRow({ label, value }: Secret) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const fieldRef = useRef<HTMLInputElement>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Plain http on the hotspot (e.g. a phone opening http://192.168.x.x) has no Clipboard API: select + copy.
      fieldRef.current?.select();
      document.execCommand("copy");
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-card border border-line bg-canvas p-3">
      <dt className="text-label text-ink-500">{label}</dt>
      <dd className="mt-1 flex items-center gap-2">
        <input
          ref={fieldRef}
          readOnly
          value={value}
          translate="no"
          spellCheck={false}
          aria-label={label}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 bg-transparent font-mono text-title tracking-wide text-ink-900 outline-none"
        />
        <Button onClick={copy} className="shrink-0">
          {copied ? t("common.copied") : t("common.copy")}
        </Button>
      </dd>
      <span aria-live="polite" className="sr-only">
        {copied ? t("common.copied") : ""}
      </span>
    </div>
  );
}
