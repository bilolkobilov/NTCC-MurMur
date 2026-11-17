"""Single-lead ECG from the device (TI ADS1292R): decode, filter, find heartbeats, judge quality.

Pure Python (no numpy), like `quality.py`, so heart rate works even on a server installed without the AI group. Only
the optional rhythm model (`services/ai/ecg_rhythm.py`) needs PyTorch.

What the device sends (`firmware/murmur/ecg.h`): little-endian int32 samples, channels interleaved (CH1, CH2, CH1,
...), the raw 24-bit ADS1292R codes sign-extended. Which channel carries the ECG depends on the cable and electrode
placement (measured 2026-11-17), so both are analysed and the cleaner one is used.

The limits below are signal-processing limits for "can we trust what we measured", not medical thresholds: the doctor
reads the numbers and the strip. Measured on the bench (2026-11-17, gel electrodes, laptop on battery): clean QRS
~0.8 mV with ~26 uV noise (SNR ~30); a bad placement gave QRS ~0.1 mV buried in slow drift.
"""

import math
import struct
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

ADS_FULL_SCALE = 2**23 - 1  # 24-bit two's complement
SATURATION_CODE = ADS_FULL_SCALE - 16  # a code this close to full scale means the input is clipped
METHOD_VERSION = "ecg-rules 1.0"

MIN_SECONDS = 5.0
MAX_SECONDS = 35.0
MIN_BEATS = 4
HR_RANGE = (30, 220)  # beats per minute the detector can be trusted for
RR_RANGE_S = (0.27, 2.0)  # one beat to the next, matching HR_RANGE
MAX_BAD_RR_FRACTION = 0.2  # more implausible intervals than this = missed or extra beats
MIN_SNR = 3.0  # median R height / noise
MAX_SATURATED_FRACTION = 0.01
MIN_SIGNAL_STD_MV = 0.01  # below this the lead carries nothing

# Problems, as codes the web app translates (frontend `ecgOutcome.ts`).
LEAD_OFF = "lead_off"
SATURATED = "saturated"
FLAT = "flat"
NO_BEATS = "no_beats"
NOISY = "noisy"
ERROR = "error"


# --- decoding ---


def decode(data: bytes, channels: int) -> list[list[int]]:
    """Raw device bytes → one list of int codes per channel. Raises ValueError for a broken length."""
    if channels < 1 or len(data) % (4 * channels):
        raise ValueError("ECG data length does not match its channel count")
    values = struct.unpack(f"<{len(data) // 4}i", data)
    return [list(values[c::channels]) for c in range(channels)]


def to_mv(codes: list[int], gain: int, vref_mv: float) -> list[float]:
    """ADS1292R code → millivolts at the electrodes: code * VREF / (gain * (2^23 - 1))."""
    scale = vref_mv / (gain * ADS_FULL_SCALE)
    return [c * scale for c in codes]


# --- filters (RBJ biquads, run forward and backward so peaks stay where they are) ---


@dataclass(frozen=True)
class Biquad:
    b: tuple[float, float, float]
    a: tuple[float, float]  # a1, a2 (a0 normalised to 1)


def _biquad(kind: str, f0: float, fs: float, q: float = 1 / math.sqrt(2)) -> Biquad:
    w0 = 2 * math.pi * f0 / fs
    cos_w, alpha = math.cos(w0), math.sin(w0) / (2 * q)
    if kind == "lowpass":
        b = ((1 - cos_w) / 2, 1 - cos_w, (1 - cos_w) / 2)
    elif kind == "highpass":
        b = ((1 + cos_w) / 2, -(1 + cos_w), (1 + cos_w) / 2)
    else:  # notch
        b = (1.0, -2 * cos_w, 1.0)
    a0 = 1 + alpha
    return Biquad((b[0] / a0, b[1] / a0, b[2] / a0), (-2 * cos_w / a0, (1 - alpha) / a0))


def _run(section: Biquad, x: list[float]) -> list[float]:
    (b0, b1, b2), (a1, a2) = section.b, section.a
    y, x1, x2, y1, y2 = [0.0] * len(x), 0.0, 0.0, 0.0, 0.0
    for i, v in enumerate(x):
        out = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        x2, x1, y2, y1 = x1, v, y1, out
        y[i] = out
    return y


def filtfilt(sections: list[Biquad], x: list[float], pad: int) -> list[float]:
    """Zero-phase filtering with mirrored ends, so the first and last beats get no start-up transient.

    A mirror (not the usual odd reflection about the first sample) because one noisy first sample would otherwise
    shift the whole padding and draw a jump at the start of the strip."""
    pad = min(pad, len(x) - 1)
    head = list(reversed(x[1 : pad + 1]))
    tail = list(reversed(x[-pad - 1 : -1]))
    y = head + x + tail
    for section in sections:
        y = _run(section, y)
    y.reverse()
    for section in sections:
        y = _run(section, y)
    y.reverse()
    return y[pad : pad + len(x)]


@lru_cache
def _display_filter(fs: int) -> list[Biquad]:
    """0.5–40 Hz plus a 50 Hz notch: baseline wander and mains hum out, P-QRS-T shape kept (what the doctor sees)."""
    sections = [_biquad("highpass", 0.5, fs), _biquad("lowpass", min(40.0, fs * 0.4), fs)]
    if fs > 110:
        sections.append(_biquad("notch", 50.0, fs, q=20))
    return sections


@lru_cache
def _qrs_filter(fs: int) -> list[Biquad]:
    """5–15 Hz: where QRS energy lives (Pan & Tompkins 1985); T waves and drift fall outside."""
    return [_biquad("highpass", 5.0, fs), _biquad("lowpass", 15.0, fs)]


# --- beat detection ---


def _percentile(values: list[float], q: float) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(q * (len(ordered) - 1)))]


def _moving_average(x: list[float], width: int) -> list[float]:
    half, out, total = width // 2, [], 0.0
    prefix = [0.0]
    for v in x:
        total += v
        prefix.append(total)
    for i in range(len(x)):
        lo, hi = max(0, i - half), min(len(x), i + half + 1)
        out.append((prefix[hi] - prefix[lo]) / (hi - lo))
    return out


def detect_r_peaks(display: list[float], fs: int) -> list[int]:
    """Sample indices of R peaks: band-pass, derivative, square, 150 ms integration, adaptive threshold."""
    band = filtfilt(_qrs_filter(fs), display, pad=fs)
    slope = [0.0] + [(band[i + 1] - band[i - 1]) * fs / 2 for i in range(1, len(band) - 1)] + [0.0]
    energy = _moving_average([s * s for s in slope], max(3, int(0.15 * fs)))
    edge = int(0.3 * fs)  # filter edges are less trustworthy
    core = energy[edge : len(energy) - edge] or energy
    threshold = 0.3 * _percentile(core, 0.99)
    if threshold <= 0:
        return []
    refractory, window = int(0.25 * fs), int(0.1 * fs)
    peaks: list[int] = []
    for i in range(max(1, edge), len(energy) - max(1, edge)):
        if energy[i] < threshold or energy[i] < energy[i - 1] or energy[i] < energy[i + 1]:
            continue
        lo, hi = max(0, i - window), min(len(display), i + window + 1)
        r = max(range(lo, hi), key=lambda k: abs(display[k]))
        if peaks and r - peaks[-1] < refractory:
            if abs(display[r]) > abs(display[peaks[-1]]):
                peaks[-1] = r
            continue
        peaks.append(r)
    return peaks


# --- one channel ---


@dataclass
class ChannelReport:
    channel: int  # 1-based, as on the ADS1292R
    problem: str | None
    beats: int = 0
    heart_rate: int | None = None
    rr_cv: float | None = None  # spread of beat-to-beat intervals (std / mean): 0 = metronome-steady
    snr: float = 0.0
    r_peaks: list[int] = field(default_factory=list)


def analyze_channel(codes: list[int], channel: int, fs: int, gain: int, vref_mv: float) -> ChannelReport:
    saturated = sum(1 for c in codes if abs(c) >= SATURATION_CODE) / len(codes)
    if saturated > MAX_SATURATED_FRACTION:
        return ChannelReport(channel, SATURATED)
    display = filtfilt(_display_filter(fs), to_mv(codes, gain, vref_mv), pad=fs)
    mean = sum(display) / len(display)
    if math.sqrt(sum((v - mean) ** 2 for v in display) / len(display)) < MIN_SIGNAL_STD_MV:
        return ChannelReport(channel, FLAT)

    peaks = detect_r_peaks(display, fs)
    near_qrs = set()
    for p in peaks:
        near_qrs.update(range(p - int(0.1 * fs), p + int(0.1 * fs) + 1))
    quiet = [v for i, v in enumerate(display) if i not in near_qrs] or display
    centre = _percentile(quiet, 0.5)
    noise = 1.4826 * _percentile([abs(v - centre) for v in quiet], 0.5) or 1e-9
    snr = _percentile([abs(display[p]) for p in peaks], 0.5) / noise if peaks else 0.0

    report = ChannelReport(channel, None, beats=len(peaks), snr=round(snr, 1), r_peaks=peaks)
    rr = [(b - a) / fs for a, b in zip(peaks, peaks[1:], strict=False)]
    if len(peaks) < MIN_BEATS or not rr:
        report.problem = NO_BEATS
        return report
    median_rr = _percentile(rr, 0.5)
    heart_rate = round(60 / median_rr)
    bad_rr = sum(1 for r in rr if not RR_RANGE_S[0] <= r <= RR_RANGE_S[1]) / len(rr)
    if not HR_RANGE[0] <= heart_rate <= HR_RANGE[1] or bad_rr > MAX_BAD_RR_FRACTION:
        report.problem = NO_BEATS
        return report
    if snr < MIN_SNR:
        report.problem = NOISY
        return report
    mean_rr = sum(rr) / len(rr)
    report.heart_rate = heart_rate
    report.rr_cv = round(math.sqrt(sum((r - mean_rr) ** 2 for r in rr) / len(rr)) / mean_rr, 3)
    return report


# --- the whole recording ---


@dataclass(frozen=True)
class EcgInput:
    data: bytes
    channels: int
    sample_rate: int
    gain: int
    vref_mv: float
    lead_off: bool  # the device saw an electrode come off during the recording


@dataclass
class EcgAnalysis:
    quality: str  # "good" | "bad"
    problem: str | None
    channel: int | None
    heart_rate: int | None
    rr_cv: float | None
    beats: int
    snr: float
    r_peaks_s: list[float]  # seconds from the start, for the strip


def analyze(ecg: EcgInput) -> EcgAnalysis:
    """Pick the cleaner channel and measure it. A lead-off flag wins: the device knows an electrode came off."""
    channels = decode(ecg.data, ecg.channels)
    reports = [
        analyze_channel(codes, i + 1, ecg.sample_rate, ecg.gain, ecg.vref_mv) for i, codes in enumerate(channels)
    ]
    good = [r for r in reports if r.problem is None]
    best = max(good or reports, key=lambda r: r.snr)
    problem = LEAD_OFF if ecg.lead_off and not good else best.problem
    ok = problem is None
    return EcgAnalysis(
        quality="good" if ok else "bad",
        problem=problem,
        channel=best.channel,
        heart_rate=best.heart_rate if ok else None,
        rr_cv=best.rr_cv if ok else None,
        beats=best.beats,
        snr=best.snr,
        r_peaks_s=[round(p / ecg.sample_rate, 3) for p in best.r_peaks],
    )


def channel_mv(ecg: EcgInput, channel: int) -> list[float]:
    """Unfiltered millivolts of one channel (input for the rhythm model, which filters on its own)."""
    return to_mv(decode(ecg.data, ecg.channels)[channel - 1], ecg.gain, ecg.vref_mv)


def display_trace(ecg: EcgInput, channel: int, max_rate: int = 250) -> tuple[int, list[float]]:
    """The filtered strip the doctor sees: (sample rate, millivolts), at most `max_rate` samples per second."""
    trace = filtfilt(_display_filter(ecg.sample_rate), channel_mv(ecg, channel), pad=2 * ecg.sample_rate)
    step = max(1, ecg.sample_rate // max_rate)
    return ecg.sample_rate // step, [round(v, 4) for v in trace[::step]]


# --- the optional rhythm model ---


@lru_cache
def get_rhythm_model():
    """The trained rhythm model, or None when its weights or PyTorch are missing (then only heart rate is shown)."""
    from app.config import get_settings

    try:
        from app.services.ai import ecg_rhythm
    except ImportError:  # server installed without the AI group
        return None
    model_dir: Path = get_settings().ai_model_dir / "ecg"
    return ecg_rhythm.load(model_dir)
