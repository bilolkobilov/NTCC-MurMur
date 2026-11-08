import { clsx } from "clsx";
import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const styles: Record<Variant, string> = {
  primary: "bg-ink-900 text-white hover:bg-ink-700",
  secondary: "border border-line-strong bg-surface text-ink-900 hover:bg-canvas",
  ghost: "text-ink-700 hover:bg-canvas",
  danger: "border border-danger/40 bg-surface text-danger hover:bg-danger/5",
};

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  /** While true the button is busy: it cannot be pressed again (double-click protection) and shows `busyText`. */
  busy?: boolean;
  busyText?: string;
};

export function Button({ variant = "secondary", busy = false, busyText, className, children, disabled, ...rest }: Props) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={clsx(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-control px-4 text-body font-semibold",
        "transition-[background-color,transform] duration-150 ease-[var(--ease-out-strong)] active:scale-[0.97]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-900",
        "disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100",
        styles[variant],
        className,
      )}
    >
      {busy && (
        <span
          className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none"
          aria-hidden="true"
        />
      )}
      {busy && busyText ? busyText : children}
    </button>
  );
}
