import { clsx } from "clsx";
import { useTranslation } from "react-i18next";

import type { Point } from "../../api/doctor";

/**
 * The four CirCor auscultation points on a chest seen from the front (the patient's RIGHT is on the screen's LEFT).
 *   AV  aortic     2nd intercostal space, right sternal border
 *   PV  pulmonary  2nd intercostal space, left sternal border
 *   TV  tricuspid  4th intercostal space, left lower sternal border
 *   MV  mitral     5th intercostal space, left mid-clavicular line (apex)
 * Schematic, not to scale: spread just enough that 44 px targets never overlap at the smallest drawing (≥ 20 % apart
 * horizontally at 240 px wide), keeping the anatomical order. Tested in features/doctor/exam/exam.test.tsx.
 */
export const POINTS: { point: Point; x: number; y: number }[] = [
  { point: "AV", x: 39, y: 33 },
  { point: "PV", x: 61, y: 33 },
  { point: "TV", x: 52, y: 53 },
  { point: "MV", x: 74, y: 65 },
];
export const MIN_DIAGRAM_WIDTH = 240;

/** Torso outline, sternum and ribs: enough anatomy to find the intercostal spaces, no more. */
export function ChestOutline() {
  const { t } = useTranslation();
  return (
    <svg viewBox="0 0 200 240" className="absolute inset-0 h-full w-full" aria-hidden="true">
      <path
        d="M58 8 C40 18 22 30 16 60 L10 230 H190 L184 60 C178 30 160 18 142 8 C128 22 116 26 100 26 C84 26 72 22 58 8Z"
        className="fill-canvas stroke-line-strong"
        strokeWidth="1.5"
      />
      <path d="M100 30 V150" className="stroke-ink-300" strokeWidth="1.5" strokeDasharray="3 3" />
      {[62, 88, 114, 140, 166].map((y) => (
        <path key={y} d={`M38 ${y} Q100 ${y + 10} 162 ${y}`} className="fill-none stroke-line" strokeWidth="1" />
      ))}
      <text x="22" y="22" className="fill-ink-500 font-sans text-[10px] font-medium">
        {t("chest.patientRightShort")}
      </text>
      <text x="170" y="22" className="fill-ink-500 font-sans text-[10px] font-medium">
        {t("chest.patientLeftShort")}
      </text>
    </svg>
  );
}

/** Read-only: where one exam was recorded. The point is marked; the other three stay as faint context. */
export function ChestMap({ point, label, className }: { point: Point; label: string; className?: string }) {
  return (
    <div role="img" aria-label={label} className={clsx("relative aspect-[5/6] w-full", className)}>
      <ChestOutline />
      {POINTS.map((p) => (
        <span
          key={p.point}
          aria-hidden="true"
          style={{ left: `${p.x}%`, top: `${p.y}%` }}
          className={clsx(
            "absolute grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full font-mono font-semibold",
            p.point === point
              ? "size-10 bg-ink-900 text-caption text-white shadow-[0_0_0_4px_var(--color-grid-minor)]"
              : "size-2.5 bg-ink-300/50",
          )}
        >
          {p.point === point && <span translate="no">{p.point}</span>}
        </span>
      ))}
    </div>
  );
}
