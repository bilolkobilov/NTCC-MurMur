import { clsx } from "clsx";
import { type ComponentProps, type ReactNode, useId, useState } from "react";

/**
 * Controls of the redesigned sign-in card (docs/redesign, frames #7–#16). They use the `auth-*` tokens and are only
 * meant for the login page; the rest of the app keeps its own components until the redesign reaches it.
 */

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    >
      {children}
    </svg>
  );
}

const EyeIcon = () => (
  <Icon>
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);
const EyeOffIcon = () => (
  <Icon>
    <path d="M9.9 5.2A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 4.4-1" />
    <path d="M3 3l18 18M9.9 9.9a3 3 0 0 0 4.2 4.2" />
  </Icon>
);
const AlertIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v5M12 16.5v.01" />
  </Icon>
);
const CheckIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="M8 12.5l3 3 5-6" />
  </Icon>
);

/** The mark from the mockup: white heart-wave on a petrol-blue rounded square. */
export function AuthLogo({ name }: { name: string }) {
  return (
    <span translate="no" className="inline-flex items-center gap-2 text-title font-semibold tracking-tight text-ink-900">
      <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
        <rect width="32" height="32" rx="8" className="fill-primary" />
        <path
          d="M6 16h4l3-7 5 14 3-7h5"
          fill="none"
          stroke="#fff"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {name}
    </span>
  );
}

type FieldProps = ComponentProps<"input"> & {
  label: string;
  error?: string;
  /** Password fields only: the two labels of the eye button ("Show password" / "Hide password"). */
  reveal?: { show: string; hide: string };
};

export function AuthField({ label, error, reveal, className, disabled, type, ...input }: FieldProps) {
  const id = useId();
  const [shown, setShown] = useState(false);
  return (
    <div className={clsx("flex flex-col gap-2", className)}>
      <label htmlFor={id} className="font-semibold text-ink-900">
        {label}
      </label>
      <div
        className={clsx(
          "flex min-h-12 items-center rounded-control border bg-surface pr-1 pl-3 focus-within:outline focus-within:outline-1",
          error
            ? "border-danger-dot focus-within:outline-danger-dot"
            : "border-line-strong focus-within:border-primary focus-within:outline-primary",
          disabled && "border-line bg-subtle",
        )}
      >
        <input
          id={id}
          {...input}
          type={reveal && shown ? "text" : type}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="min-h-10 min-w-0 flex-1 bg-transparent text-[16px] text-ink-900 outline-0 placeholder:text-ink-500 disabled:cursor-not-allowed disabled:text-ink-500"
        />
        {reveal && (
          <button
            type="button"
            disabled={disabled}
            aria-label={shown ? reveal.hide : reveal.show}
            aria-pressed={shown}
            onClick={() => setShown((value) => !value)}
            className={clsx(
              "grid size-11 shrink-0 place-items-center rounded-sm text-ink-700 hover:bg-subtle hover:text-ink-900 disabled:cursor-not-allowed disabled:text-ink-500 disabled:hover:bg-transparent",
              focusRing,
            )}
          >
            {shown ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        )}
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="flex items-start gap-2 font-medium text-danger">
          <span className="mt-0.5">
            <AlertIcon />
          </span>
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

export function AuthButton({
  busy = false,
  busyText,
  className,
  children,
  disabled,
  ...rest
}: ComponentProps<"button"> & { busy?: boolean; busyText?: string }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={clsx(
        "inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control bg-primary px-4 font-semibold text-white hover:bg-primary-hover",
        "disabled:cursor-not-allowed disabled:bg-subtle disabled:text-ink-500",
        busy && "cursor-progress disabled:bg-primary-hover disabled:text-white",
        focusRing,
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

type Tone = "critical" | "success" | "info";
const tones: Record<Tone, string> = {
  critical: "bg-danger-bg text-danger",
  success: "bg-clear-bg text-clear",
  info: "bg-primary-tint text-primary-ink",
};

/** Icon + words, never colour alone. A title is optional. */
export function AuthAlert({ tone, title, children }: { tone: Tone; title?: string; children: ReactNode }) {
  return (
    <div role={tone === "critical" ? "alert" : "status"} className={clsx("flex gap-3 rounded-control px-4 py-3", tones[tone])}>
      <span className="mt-0.5">{tone === "success" ? <CheckIcon /> : <AlertIcon />}</span>
      <div className="flex flex-col gap-1">
        {title && <p className="font-semibold">{title}</p>}
        <p>{children}</p>
      </div>
    </div>
  );
}

type Option<T extends string> = { value: T; label: string };

/** Small radio-style choice (arrow keys move between options), drawn as a compact segmented control. */
export function AuthSegmented<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const move = (index: number, step: number) => {
    const next = options[(index + step + options.length) % options.length];
    onChange(next.value);
    document.getElementById(`seg-${next.value}`)?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex gap-0.5 rounded-control bg-subtle p-0.5">
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            id={`seg-${option.value}`}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                event.preventDefault();
                move(index, 1);
              } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                event.preventDefault();
                move(index, -1);
              }
            }}
            className={clsx(
              "min-h-11 rounded-sm border-2 px-3 text-center text-label font-medium disabled:cursor-not-allowed disabled:text-ink-500",
              selected
                ? "border-primary bg-surface font-semibold text-ink-900 disabled:border-line"
                : "border-transparent text-ink-700 hover:text-ink-900",
              focusRing,
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
