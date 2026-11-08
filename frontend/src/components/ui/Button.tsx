import { clsx } from "clsx";
import type { ButtonHTMLAttributes } from "react";
import { Link, type LinkProps } from "react-router";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const styles: Record<Variant, string> = {
  primary: "bg-ink-900 text-white hover:bg-ink-700",
  secondary: "border border-line-strong bg-surface text-ink-900 hover:border-ink-300 hover:bg-canvas",
  ghost: "text-ink-700 hover:bg-canvas hover:text-ink-900",
  danger: "border border-danger/40 bg-surface text-danger hover:border-danger hover:bg-danger/5",
};

const base = [
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-control px-4 text-body font-semibold",
  "transition-[background-color,border-color,transform] duration-150 ease-[var(--ease-out-strong)] active:scale-[0.97]",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-900",
];

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
        base,
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

/** Navigation that looks like a button — still a real link (Ctrl+click, middle-click work). */
export function ButtonLink({ variant = "secondary", className, ...rest }: LinkProps & { variant?: Variant }) {
  return <Link {...rest} className={clsx(base, styles[variant], className as string)} />;
}
