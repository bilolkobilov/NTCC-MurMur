"""Simple recording quality rules (PLAN.md 5.1) — plain signal checks, not AI.

A recording that fails any rule is not analyzed; the exam fails with a "re-record" reason the doctor sees.
Thresholds were checked against real CirCor recordings (docs/decisions/2026-11.md).
"""

import math
import wave
from array import array
from dataclasses import dataclass
from pathlib import Path

from app.config import get_settings

SILENT_PEAK = 0.01  # loudest sample below 1 % of full scale (−40 dBFS): nothing was picked up
CLIP_LEVEL = 0.99  # a sample this close to full scale is treated as clipped
MAX_CLIPPED_FRACTION = 0.01  # more than 1 % clipped samples: too loud / microphone overdriven


@dataclass(frozen=True)
class SignalStats:
    duration_s: float
    peak: float  # 0..1 of full scale
    rms: float  # 0..1 of full scale
    clipped_fraction: float


def read_samples(path: Path) -> tuple[list[float] | array, int, int]:
    """Return (samples, full_scale, sample_rate) for 8/16/24/32-bit PCM; channels stay interleaved."""
    with wave.open(str(path)) as wav:
        width, rate, raw = wav.getsampwidth(), wav.getframerate(), wav.readframes(wav.getnframes())
    if width == 1:  # unsigned 8-bit
        return [b - 128 for b in raw], 128, rate
    if width == 2:
        return array("h", raw), 32768, rate
    if width == 4:
        return array("i", raw), 2**31, rate
    if width == 3:
        return [int.from_bytes(raw[i : i + 3], "little", signed=True) for i in range(0, len(raw), 3)], 2**23, rate
    raise ValueError(f"unsupported sample width: {width} bytes")


def measure(path: Path, duration_s: float) -> SignalStats:
    samples, full_scale, _ = read_samples(path)
    if len(samples) == 0:
        return SignalStats(duration_s, 0.0, 0.0, 0.0)
    peak = max(abs(s) for s in samples) / full_scale
    rms = math.sqrt(sum(s * s for s in samples) / len(samples)) / full_scale
    clip_at = CLIP_LEVEL * full_scale
    clipped = sum(1 for s in samples if abs(s) >= clip_at) / len(samples)
    return SignalStats(duration_s, peak, rms, clipped)


def problems(stats: SignalStats, motion_detected: bool) -> list[str]:
    """Human-readable reasons to re-record; empty list = good enough to analyze."""
    found = []
    min_seconds = get_settings().min_recording_seconds
    if stats.duration_s < min_seconds:
        found.append(f"too short ({stats.duration_s:.1f} s, need at least {min_seconds} s)")
    if stats.peak < SILENT_PEAK:
        found.append("almost silent (is the stethoscope touching the chest?)")
    if stats.clipped_fraction > MAX_CLIPPED_FRACTION:
        found.append(f"too loud, {stats.clipped_fraction:.0%} of the sound is clipped")
    if motion_detected:
        found.append("movement detected during recording")
    return found
