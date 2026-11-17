import type { ReactNode } from "react";

import { DAlert } from "../../redesign/components";

type Tone = "info" | "danger" | "clear";

const map = {
  info: { tone: "info", icon: "help" },
  danger: { tone: "crit", icon: "alertTriangle" },
  clear: { tone: "ok", icon: "checkCircle" },
} as const;

/** A message box (redesign `rd-dalert`). Colour is always paired with an icon and words (never colour alone). */
export function Alert({ tone = "info", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <DAlert tone={map[tone].tone} icon={map[tone].icon}>
      {children}
    </DAlert>
  );
}
