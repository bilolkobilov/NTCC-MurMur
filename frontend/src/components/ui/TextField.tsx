import { clsx } from "clsx";
import { type ComponentProps, useId } from "react";

type Props = ComponentProps<"input"> & { label: string; hint?: string; error?: string };

/**
 * Label + inset input + hint/error, all linked for screen readers. Pass `ref` to focus it (first invalid field).
 * The field is a touch darker than the card (it "receives" text) and turns white while focused.
 */
export function TextField({ label, hint, error, className, required, ...input }: Props) {
  const id = useId();
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
  return (
    <div className={clsx("flex flex-col gap-1.5", className)}>
      {/* The asterisk is CSS-only so the field's name stays clean; `required` already announces it. */}
      <label
        htmlFor={id}
        className={clsx(
          "text-label font-medium text-ink-700",
          required && "after:ml-1 after:text-ink-300 after:content-['*']",
        )}
      >
        {label}
      </label>
      <input
        id={id}
        {...input}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={clsx(
          "min-h-11 rounded-control border bg-field px-3 text-body text-ink-900 placeholder:text-ink-300",
          "transition-[background-color,border-color] duration-150",
          "focus:border-ink-900 focus:bg-surface focus:outline-2 focus:outline-offset-1 focus:outline-ink-900/15",
          error ? "border-danger" : "border-line-strong hover:border-ink-300",
        )}
      />
      {hint && !error && (
        <p id={`${id}-hint`} className="text-caption text-ink-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-caption font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
