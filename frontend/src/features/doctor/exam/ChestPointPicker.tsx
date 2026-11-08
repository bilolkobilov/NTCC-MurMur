import { clsx } from "clsx";
import type { Ref } from "react";
import { useTranslation } from "react-i18next";

import type { Point } from "../../../api/doctor";
import { ChestOutline, POINTS } from "../../../components/exam/ChestDiagram";

// Points, outline and their anatomy notes live in components/exam/ChestDiagram (shared with the patient's page).
export { MIN_DIAGRAM_WIDTH, POINTS } from "../../../components/exam/ChestDiagram";

/** Native radio buttons (arrow keys, screen readers) placed over the drawing; 44 px hit areas. */
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
          <ChestOutline />
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
