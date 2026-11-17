import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { doctorApi, type EcgResult, type EcgTrace } from "../../../api/doctor";
import { Alert } from "../../../components/ui/Alert";
import { formatNumber } from "../../../lib/format";
import { DAlert } from "../../../redesign/components";
import { type EcgOutcome, ecgOutcome } from "./ecgOutcome";

/** Paper speed of the close-up: 25 mm/s is the clinical standard; one big square (5 mm) = 0.2 s = 40 px here. */
const CLOSE_UP_PX_PER_SEC = 200;
const STRIP_HEIGHT = 160;
const MV_PER_HALF_HEIGHT = 1.6; // ±1.6 mV fill the strip: a normal QRS (~1 mV) is clearly visible, noise stays small

type Zoom = "whole" | "closeUp";

/**
 * The single-lead ECG recorded together with the sound (owner, 2026-11-17), on the same chart paper as the heart-sound
 * strip, under it, so the doctor can see which sound falls into which heartbeat (S1 follows the R wave). The numbers
 * come from the server; a poor ECG says "cannot judge" and shows no numbers. Doctors only.
 */
export function EcgCard({ examId, hasEcg, result }: { examId: number; hasEcg: boolean; result: EcgResult | null }) {
  const { t } = useTranslation();
  // `hasEcg` = a usable strip exists; a result without it means the device sent a broken ECG ("cannot judge").
  if (!hasEcg && !result) {
    return <p className="rd-sm">{t("ecg.notRecorded")}</p>;
  }
  const outcome = ecgOutcome(result);
  return (
    <section aria-labelledby="ecg-title" className="rd-dcard">
      <div className="rd-dcard__head">
        <div className="flex flex-col gap-0.5">
          <h2 id="ecg-title" className="rd-h3">
            {t("ecg.title")}
          </h2>
          <span className="rd-sm">{t("ecg.subtitle")}</span>
        </div>
        <EcgFacts outcome={outcome} />
      </div>
      <div className="rd-dcard__body">
        <EcgVerdict outcome={outcome} />
        {hasEcg && <EcgTraceView examId={examId} />}
        <p className="rd-sm">{t("ecg.disclaimer")}</p>
      </div>
    </section>
  );
}

function EcgFacts({ outcome }: { outcome: EcgOutcome }) {
  const { t, i18n } = useTranslation();
  if (outcome.kind !== "measured") return null;
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-1">
      <div className="flex flex-col">
        <dt className="rd-sm">{t("ecg.heartRate")}</dt>
        <dd className="rd-h2 tabular-nums">
          {outcome.heartRate} <span className="rd-sm">{t("ecg.perMin")}</span>
        </dd>
      </div>
      {outcome.spread !== null && (
        <div className="flex flex-col">
          <dt className="rd-sm">{t("ecg.spread")}</dt>
          <dd className="rd-h2 tabular-nums">
            {formatNumber(Math.round(outcome.spread * 100), i18n.language)}
            <span className="rd-sm"> %</span>
          </dd>
        </div>
      )}
    </dl>
  );
}

function EcgVerdict({ outcome }: { outcome: EcgOutcome }) {
  const { t, i18n } = useTranslation();
  if (outcome.kind === "pending") return <p className="rd-body">{t("ecg.pending")}</p>;
  if (outcome.kind === "cannotJudge") {
    return (
      <DAlert tone="warn" icon="alertTriangle" role="status">
        <strong>{t("ecg.cannotJudge")}</strong> {t(`ecg.problem.${outcome.problem}`)}
      </DAlert>
    );
  }
  if (!outcome.rhythm) return <p className="rd-body">{t("ecg.noRhythmModel")}</p>;
  const { label, pAf, model } = outcome.rhythm;
  const probability = pAf === null ? null : formatNumber(Math.round(pAf * 100), i18n.language);
  return (
    <div className="flex flex-col gap-1">
      {label === "af_suspected" ? (
        <DAlert tone="warn" icon="alertTriangle" role="status">
          <strong>{t("ecg.rhythm.af_suspected")}</strong> {t("ecg.rhythm.confirm")}
        </DAlert>
      ) : (
        <p className="rd-label">{t(`ecg.rhythm.${label}`)}</p>
      )}
      <p className="rd-sm">
        {probability !== null && <>{t("ecg.rhythm.probability", { value: probability })} · </>}
        <span translate="no">{t("ecg.rhythm.model", { model })}</span>
      </p>
    </div>
  );
}

function EcgTraceView({ examId }: { examId: number }) {
  const { t, i18n } = useTranslation();
  const [zoom, setZoom] = useState<Zoom>("whole");
  const trace = useQuery({ queryKey: ["exam", examId, "ecg"], queryFn: () => doctorApi.examEcg(examId), staleTime: Infinity });

  if (trace.isPending) return <div className="rd-skeleton" style={{ height: STRIP_HEIGHT }} aria-label={t("common.loading")} />;
  if (trace.isError) return <Alert tone="danger">{t("ecg.loadError")}</Alert>;
  const data = trace.data;
  const seconds = data.samples_mv.length / data.sample_rate;
  const majorS = zoom === "closeUp" ? 0.2 : 1;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="rd-sm">{t("ecg.scale", { seconds: formatNumber(majorS, i18n.language) })}</span>
        <div role="group" aria-label={t("ecg.zoom")} className="rd-seg">
          {(["whole", "closeUp"] as const).map((z) => (
            <button key={z} type="button" aria-pressed={zoom === z} className="rd-seg__btn" onClick={() => setZoom(z)}>
              {t(`ecg.${z}`)}
            </button>
          ))}
        </div>
      </div>
      <div className={clsx("rounded-control border border-grid-major", zoom === "closeUp" && "overflow-x-auto")}>
        <EcgSvg data={data} seconds={seconds} closeUp={zoom === "closeUp"} />
      </div>
      <p className="rd-sm">{t("ecg.markers", { count: data.r_peaks_s.length })}</p>
    </div>
  );
}

/** The trace as one SVG path on a millimetre grid; R peaks the server found are small ticks along the top. */
export function EcgSvg({ data, seconds, closeUp }: { data: EcgTrace; seconds: number; closeUp: boolean }) {
  const { t } = useTranslation();
  // The whole strip uses a fixed coordinate width and scales to the card; the close-up is drawn at paper speed.
  const width = closeUp ? Math.round(seconds * CLOSE_UP_PX_PER_SEC) : 1000;
  const pxPerSec = width / seconds;
  const majorS = closeUp ? 0.2 : 1;
  const mid = STRIP_HEIGHT / 2;
  const yOf = (mv: number) => mid - Math.max(-1, Math.min(1, mv / MV_PER_HALF_HEIGHT)) * (mid - 6);
  const step = Math.max(1, Math.floor(data.samples_mv.length / (width * 2))); // at most ~2 points per pixel
  let path = "";
  for (let i = 0; i < data.samples_mv.length; i += step) {
    const x = (i / data.sample_rate) * pxPerSec;
    path += `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${yOf(data.samples_mv[i]).toFixed(1)}`;
  }
  const majorPx = majorS * pxPerSec;
  const verticals = Array.from({ length: Math.floor(seconds / majorS) + 1 }, (_, k) => k * majorPx);
  const horizontals = [-1, -0.5, 0, 0.5, 1].map((mv) => yOf(mv * MV_PER_HALF_HEIGHT));
  return (
    <svg
      role="img"
      aria-label={t("ecg.traceLabel", { beats: data.r_peaks_s.length, seconds: Math.round(seconds) })}
      viewBox={`0 0 ${width} ${STRIP_HEIGHT}`}
      preserveAspectRatio="none"
      width={closeUp ? width : "100%"}
      height={STRIP_HEIGHT}
      className="block bg-surface"
    >
      <g stroke="var(--color-grid-major)" strokeWidth={1} vectorEffect="non-scaling-stroke">
        {verticals.map((x) => (
          <line key={`v${x}`} x1={x} x2={x} y1={0} y2={STRIP_HEIGHT} vectorEffect="non-scaling-stroke" />
        ))}
        {horizontals.map((y) => (
          <line key={`h${y}`} x1={0} x2={width} y1={y} y2={y} vectorEffect="non-scaling-stroke" />
        ))}
      </g>
      <g stroke="var(--color-ink-500)" strokeWidth={2} vectorEffect="non-scaling-stroke">
        {data.r_peaks_s.map((s) => (
          <line key={`r${s}`} x1={s * pxPerSec} x2={s * pxPerSec} y1={0} y2={8} vectorEffect="non-scaling-stroke" />
        ))}
      </g>
      <path d={path} fill="none" stroke="var(--color-signal)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
