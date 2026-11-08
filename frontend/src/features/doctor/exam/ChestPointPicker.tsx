import { clsx } from "clsx";
import type { Ref } from "react";
import { useTranslation } from "react-i18next";

import type { Point } from "../../../api/doctor";

/**
 * The four CirCor auscultation points on a chest the doctor faces: the patient's RIGHT is on the screen's LEFT.
 *   AV  aortic     2nd intercostal space, right sternal border
 *   PV  pulmonary  2nd intercostal space, left sternal border
 *   TV  tricuspid  4th intercostal space, left lower sternal border
 *   MV  mitral     5th intercostal space, left mid-clavicular line (apex)
 * Native radio buttons (arrow keys, screen readers) placed over the drawing; 44 px hit areas.
 */
// Schematic, not to scale: spread just enough that the 44 px targets never overlap at the smallest drawing
// (≥ 20 % apart horizontally at 240 px wide), keeping the anatomical order: AV right of the sternum, PV left,
// TV low on the left sternal edge, MV lowest and furthest left (the apex). Tested in exam.test.tsx.
export const POINTS: { point: Point; x: number; y: number }[] = [
  { point: "AV", x: 39, y: 33 },
  { point: "PV", x: 61, y: 33 },
  { point: "TV", x: 52, y: 53 },
  { point: "MV", x: 74, y: 65 },
];
export const MIN_DIAGRAM_WIDTH = 240;

export function ChestPointPicker({
  value,
  onChange,
  error,
  firstRef,
}: {
  value: Point | null;
  onChange: (point: Point) => void;
  error?: string;
  firstRef?: Ref<HTMLInputElement>;
}) {
  const { t } = useTranslation();
  return (
    <fieldset aria-describedby={error ? "point-error" : "point-hint"}>
      <legend className="text-label font-medium text-ink-700 after:ml-1 after:text-ink-300 after:content-['*']">
        {t("newExam.point")}
      </legend>
      <div className="mt-2 grid items-center gap-5 sm:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
        <div className="relative mx-auto aspect-[5/6] w-full max-w-[260px] min-w-[240px]">
          <svg viewBox="0 0 200 240" className="absolute inset-0 h-full w-full" aria-hidden="true">
            <path
              d="M58 8 C40 18 22 30 16 60 L10 230 H190 L184 60 C178 30 160 18 142 8 C128 22 116 26 100 26 C84 26 72 22 58 8Z"
              className="fill-canvas stroke-line-strong"
              strokeWidth="1.5"
            />
            {/* sternum + ribs: enough anatomy to find the intercostal spaces, no more */}
            <path d="M100 30 V150" className="stroke-ink-300" strokeWidth="1.5" strokeDasharray="3 3" />
            {[62, 88, 114, 140, 166].map((y) => (
              <path key={y} d={`M38 ${y} Q100 ${y + 10} 162 ${y}`} className="fill-none stroke-line" strokeWidth="1" />
            ))}
            <text x="22" y="22" className="fill-ink-500 font-mono text-[10px]">
              {t("chest.patientRightShort")}
            </text>
            <text x="170" y="22" className="fill-ink-500 font-mono text-[10px]">
              {t("chest.patientLeftShort")}
            </text>
          </svg>
          {POINTS.map(({ point, x, y }, index) => (
            <label
              key={point}
              style={{ left: `${x}%`, top: `${y}%` }}
              className={clsx(
                "absolute grid size-11 -translate-x-1/2 -translate-y-1/2 cursor-pointer place-items-center rounded-full",
                "font-mono text-label font-semibold transition-[background-color,color,box-shadow] duration-150",
                "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink-900",
                value === point
                  ? "bg-ink-900 text-white shadow-[0_0_0_4px_var(--color-grid-minor)]"
                  : "border border-ink-300 bg-surface text-ink-700 hover:border-ink-900",
              )}
            >
              <input
                ref={index === 0 ? firstRef : undefined}
                type="radio"
                name="point"
                value={point}
                checked={value === point}
                onChange={() => onChange(point)}
                className="sr-only"
                aria-label={`${point} — ${t(`exam.point.${point}`)}`}
              />
              <span translate="no" aria-hidden="true">
                {point}
              </span>
            </label>
          ))}
        </div>
        <div>
          <ul className="flex flex-col gap-1.5 text-label" aria-hidden="true">
            {POINTS.map(({ point }) => (
              <li key={point} className={clsx("flex gap-2", value === point ? "font-semibold text-ink-900" : "text-ink-500")}>
                <span translate="no" className="w-7 font-mono">
                  {point}
                </span>
                <span>
                  {t(`exam.point.${point}`)} · {t(`chest.where.${point}`)}
                </span>
              </li>
            ))}
          </ul>
          <p id="point-hint" className="mt-3 text-caption text-ink-500">
            {t("chest.orientation")}
          </p>
          {error && (
            <p id="point-error" className="mt-2 text-caption font-medium text-danger">
              {error}
            </p>
          )}
        </div>
      </div>
    </fieldset>
  );
}
