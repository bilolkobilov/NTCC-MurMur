import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { type CSSProperties, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type WaveSurfer from "wavesurfer.js";

import { doctorApi } from "../../../api/doctor";
import { Button } from "../../../components/ui/Button";
import { formatClock, formatNumber } from "../../../lib/format";

/** Paper speed of the close-up: 200 px per second, so one big 40 px square is 0.2 s — like a printed strip. */
export const PAPER_PX_PER_SEC = 200;
const STEP_S = 0.5; // arrow key; Shift+arrow = 4 steps
const WAVE_HEIGHT = 128;
// Heart sounds and murmurs sit below ~1 kHz; above that the spectrogram would be empty paper.
const SPECTROGRAM_MAX_HZ = 1000;

type Zoom = "whole" | "paper";
type Spectrogram = { destroy: () => void };

/** Colour of a token from index.css @theme, so the canvas uses the same palette as the rest of the page. */
function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(`--color-${name}`).trim() || "#000";
}

/**
 * 256 colours from paper white through the grid pinks and the signal red to ink: the spectrogram stays on "paper".
 * Most of the scale is light, so background noise stays pale and only real sound turns red (a noisy recording
 * was one red block with evenly spaced stops).
 */
/** "#c1121f" or the short "#fff" (the CSS build shortens white) → [r, g, b] in 0..1. */
export function hexToRgb(color: string): number[] {
  let hex = color.trim().replace("#", "");
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return [0, 0, 0];
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
}

const COLOR_STOPS: [string, number][] = [
  ["surface", 0],
  ["grid-minor", 0.45],
  ["grid-major", 0.7],
  ["signal", 0.88],
  ["ink-900", 1],
];
function paperColorMap(): number[][] {
  const stops = COLOR_STOPS.map(([name, at]) => ({ at, rgb: hexToRgb(token(name)) }));
  return Array.from({ length: 256 }, (_, i) => {
    const x = i / 255;
    const upper = stops.findIndex((s) => s.at >= x);
    const b = stops[Math.max(1, upper)];
    const a = stops[Math.max(0, Math.max(1, upper) - 1)];
    const t = (x - a.at) / (b.at - a.at);
    return [...a.rgb.map((c, k) => c + (b.rgb[k] - c) * t), 1];
  });
}

/**
 * Grid squares from the real time scale. Big square = 0.2 s when that is at least 24 px wide (the close-up),
 * otherwise 1 s (the whole recording on a phone or laptop). Minor lines are hidden when they would be a pink blur.
 */
export function gridScale(pxPerSec: number): { majorS: number; majorPx: number; minorPx: number; showMinor: boolean } {
  const majorS = pxPerSec * 0.2 >= 24 ? 0.2 : 1;
  const majorPx = pxPerSec * majorS;
  const minorPx = majorPx / 5;
  return { majorS, majorPx, minorPx, showMinor: minorPx >= 6 };
}

/**
 * The loudness the strip is scaled to: the 99.9th percentile of |sample| (CirCor samples: 0.3–0.5 of the max), so rare knocks (above it are
 * cut at the strip's edge) do not shrink the heart sounds. Plain max would let one spike flatten the whole trace.
 */
export function robustPeak(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  const magnitudes = Float32Array.from(samples, Math.abs).sort();
  return magnitudes[Math.min(magnitudes.length - 1, Math.floor(magnitudes.length * 0.999))];
}

/**
 * The heart-sound recording on chart paper: listen, seek, zoom, spectrogram.
 * The WAV is fetched with the login token (never a public URL) and handed to wavesurfer as a blob.
 * Keyboard: the strip is a slider — ←/→ seek 0.5 s (Shift: 2 s), Home/End, Space plays/pauses.
 */
export function HeartStrip({ examId }: { examId: number }) {
  const { t, i18n } = useTranslation();
  const audio = useQuery({
    queryKey: ["examAudio", examId],
    queryFn: ({ signal }) => doctorApi.examAudio(examId, signal),
    staleTime: Infinity, // the recording never changes
  });
  const host = useRef<HTMLDivElement>(null);
  const [ws, setWs] = useState<WaveSurfer | null>(null);
  const [decodeFailed, setDecodeFailed] = useState(false);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [pxPerSec, setPxPerSec] = useState(0);
  const [zoom, setZoom] = useState<Zoom>("whole");
  const [spectrogram, setSpectrogram] = useState(false);

  // Create wavesurfer once per recording; destroy it on unmount (StrictMode mounts twice — that is fine).
  useEffect(() => {
    const blob = audio.data;
    const container = host.current;
    if (!blob || !container) return;
    let cancelled = false;
    let instance: WaveSurfer | undefined;
    void import("wavesurfer.js").then(({ default: WaveSurferClass }) => {
      if (cancelled) return;
      instance = WaveSurferClass.create({
        container,
        height: WAVE_HEIGHT,
        waveColor: token("signal"), // the trace still to be heard
        progressColor: token("ink-700"), // already heard: "ink" that has dried
        cursorColor: token("ink-900"),
        cursorWidth: 2,
        normalize: true, // quiet chest recordings still fill the strip; loudness was checked before analysis
        minPxPerSec: 0,
        fillParent: true,
        autoScroll: true,
        dragToSeek: true,
      });
      // One knock on the stethoscope must not flatten every heartbeat: scale to a robust peak instead.
      instance.on("decode", () => {
        const data = instance!.getDecodedData();
        const peak = data ? robustPeak(data.getChannelData(0)) : 0;
        if (peak > 0) instance!.setOptions({ maxPeak: peak });
      });
      const measure = () => {
        const seconds = instance!.getDuration();
        if (seconds > 0) setPxPerSec(instance!.getWrapper().scrollWidth / seconds);
      };
      instance.on("ready", (seconds) => {
        setDuration(seconds);
        measure();
      });
      instance.on("redrawcomplete", measure);
      instance.on("timeupdate", setTime);
      instance.on("play", () => setPlaying(true));
      instance.on("pause", () => setPlaying(false));
      instance.on("finish", () => setPlaying(false));
      instance.on("error", () => setDecodeFailed(true));
      instance.loadBlob(blob).catch(() => {
        if (!cancelled) setDecodeFailed(true);
      });
      setWs(instance);
    });
    return () => {
      cancelled = true;
      instance?.destroy();
    };
  }, [audio.data]);

  useEffect(() => {
    if (!ws || duration === 0) return;
    ws.zoom(zoom === "paper" ? PAPER_PX_PER_SEC : 0);
  }, [ws, duration, zoom]);

  useEffect(() => {
    if (!ws || duration === 0 || !spectrogram) return;
    let plugin: Spectrogram | undefined;
    let cancelled = false;
    void import("wavesurfer.js/plugins/spectrogram").then(({ default: SpectrogramPlugin }) => {
      if (cancelled) return;
      plugin = ws.registerPlugin(
        SpectrogramPlugin.create({
          height: 160,
          labels: true,
          labelsColor: token("ink-500"),
          labelsHzColor: token("ink-500"),
          labelsBackground: "rgba(255,255,255,0.75)",
          frequencyMax: SPECTROGRAM_MAX_HZ,
          scale: "linear",
          autoGain: true, // loudest sound = darkest ink, whatever the microphone gain
          rangeDB: 70, // 70 dB below the loudest beat: room for the quiet murmur between beats
          colorMap: paperColorMap(),
        }),
      );
    });
    return () => {
      cancelled = true;
      plugin?.destroy();
    };
  }, [ws, duration, spectrogram]);

  const grid = gridScale(pxPerSec || PAPER_PX_PER_SEC);
  const ready = duration > 0;
  const failed = audio.isError || decodeFailed;

  const seek = (seconds: number) => {
    if (!ws || !ready) return;
    ws.setTime(Math.min(duration, Math.max(0, seconds)));
  };
  const onKey = (event: KeyboardEvent) => {
    const step = event.shiftKey ? STEP_S * 4 : STEP_S;
    const actions: Record<string, () => void> = {
      ArrowRight: () => seek(time + step),
      ArrowUp: () => seek(time + step),
      ArrowLeft: () => seek(time - step),
      ArrowDown: () => seek(time - step),
      Home: () => seek(0),
      End: () => seek(duration),
      " ": () => void ws?.playPause(),
    };
    const action = actions[event.key];
    if (action && ready) {
      event.preventDefault();
      action();
    }
  };

  return (
    <section aria-labelledby="strip-title" className="rounded-card border border-line bg-surface">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 pt-4 sm:px-6">
        <h2 id="strip-title" className="text-title font-semibold">
          {t("result.recording")}
        </h2>
        {ready && (
          <p className="font-mono text-caption text-ink-500 tabular-nums">
            {t("result.scale", { seconds: formatNumber(grid.majorS, i18n.language) })}
          </p>
        )}
      </div>

      <div className="px-4 pt-3 sm:px-6">
        {failed ? (
          <div className="flex min-h-32 flex-col items-start justify-center gap-3 rounded-control border border-line bg-canvas p-4">
            <p className="text-ink-700">{audio.isError ? t("result.audioLoadFailed") : t("result.audioDecodeFailed")}</p>
            {audio.isError && <Button onClick={() => void audio.refetch()}>{t("common.retry")}</Button>}
          </div>
        ) : (
          <div className="relative">
            <div
              ref={host}
              role="slider"
              tabIndex={0}
              aria-label={t("result.stripLabel")}
              aria-valuemin={0}
              aria-valuemax={Math.round(duration * 10) / 10}
              aria-valuenow={Math.round(time * 10) / 10}
              aria-valuetext={t("result.position", {
                time: formatClock(time, i18n.language),
                total: formatClock(duration, i18n.language),
              })}
              onKeyDown={onKey}
              className={clsx(
                "strip-host overflow-hidden rounded-control border border-grid-major",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-900",
              )}
              style={
                {
                  "--grid-major": `${grid.majorPx}px`,
                  "--grid-minor": `${grid.minorPx}px`,
                  "--grid-minor-color": grid.showMinor ? undefined : "transparent",
                  minHeight: WAVE_HEIGHT + 2,
                } as CSSProperties
              }
            />
            {!ready && (
              <div
                className="chart-grid absolute inset-0 grid place-items-center rounded-control border border-grid-major"
                role="status"
              >
                <span className="rounded-control bg-surface/90 px-3 py-1 text-label text-ink-500">
                  {t("result.audioLoading")}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-4 sm:px-6">
        <button
          type="button"
          onClick={() => void ws?.playPause()}
          disabled={!ready}
          aria-label={playing ? t("result.pause") : t("result.play")}
          className={clsx(
            "grid size-11 shrink-0 place-items-center rounded-full bg-ink-900 text-white",
            "transition-[background-color,transform] duration-150 hover:bg-ink-700 active:scale-[0.96]",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-900",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          {playing ? (
            <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true">
              <rect x="3" y="2" width="3.5" height="12" rx="1" fill="currentColor" />
              <rect x="9.5" y="2" width="3.5" height="12" rx="1" fill="currentColor" />
            </svg>
          ) : (
            // Nudged 1 px right: a triangle's visual centre is left of its box centre.
            <svg viewBox="0 0 16 16" className="size-4 translate-x-px" aria-hidden="true">
              <path d="M4 2.5v11a1 1 0 0 0 1.5.86l9-5.5a1 1 0 0 0 0-1.72l-9-5.5A1 1 0 0 0 4 2.5Z" fill="currentColor" />
            </svg>
          )}
        </button>
        <p className="font-mono text-label text-ink-700 tabular-nums" aria-hidden="true">
          {formatClock(time, i18n.language)} <span className="text-ink-300">/ {formatClock(duration, i18n.language)}</span>
        </p>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div role="group" aria-label={t("result.zoom")} className="flex rounded-control border border-line-strong p-0.5">
            {(["whole", "paper"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={zoom === value}
                disabled={!ready}
                onClick={() => setZoom(value)}
                className={clsx(
                  "min-h-10 rounded-[6px] px-3 text-label font-medium transition-[background-color,color] duration-150",
                  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink-900",
                  zoom === value ? "bg-ink-900 text-white" : "text-ink-700 hover:bg-canvas",
                )}
              >
                {t(`result.zoom_${value}`)}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-pressed={spectrogram}
            disabled={!ready}
            onClick={() => setSpectrogram((on) => !on)}
            className={clsx(
              "min-h-11 rounded-control border px-3 text-label font-medium transition-[background-color,border-color] duration-150",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-900",
              spectrogram ? "border-ink-900 bg-ink-900 text-white" : "border-line-strong text-ink-700 hover:bg-canvas",
            )}
          >
            {t("result.spectrogram")}
          </button>
        </div>
      </div>
    </section>
  );
}
