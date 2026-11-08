import { clsx } from "clsx";
import type { ReactNode } from "react";

type Tone = "info" | "danger" | "clear";

const tones: Record<Tone, { box: string; icon: string }> = {
  info: { box: "border-line-strong bg-canvas text-ink-700", icon: "i" },
  danger: { box: "border-danger/30 bg-danger/5 text-danger", icon: "!" },
  clear: { box: "border-clear/30 bg-clear-bg text-clear", icon: "✓" },
};

/** A message box. Colour is always paired with an icon and words (never colour alone). */
export function Alert({ tone = "info", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={clsx("flex items-start gap-2.5 rounded-control border px-3 py-2.5 text-body", tones[tone].box)}
    >
      <span
        aria-hidden="true"
        className="mt-1 grid size-4 shrink-0 place-items-center rounded-full border border-current font-mono text-[10px] leading-none font-semibold"
      >
        {tones[tone].icon}
      </span>
      <span>{children}</span>
    </div>
  );
}
