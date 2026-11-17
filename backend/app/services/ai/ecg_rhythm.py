"""ECG rhythm model: 20 s of one chest lead → "AF suspected" / "no AF" / "unclear". Screening aid, not a diagnosis.

Input contract (our ADS1292R lead, roughly lead II): a 1-D signal in mV at any sample rate. `preprocess()` resamples
it to 250 Hz, keeps the first 20 s (shorter input is zero-padded at the end), band-passes 0.5–40 Hz (this also
removes 50 / 60 Hz mains hum) and scales it robustly. Training (scripts/ai/ecg/train.py) uses exactly these functions.

The network is a small 1-D ResNet with 4 outputs (normal, af, other, noisy; PhysioNet/CinC Challenge 2017 classes).
Product decision (owner, 2026-11-17): only AF is shown. "unclear" when "noisy" is the most likely class; otherwise
"af_suspected" when P(af) ≥ the threshold stored in `ecg_rhythm.json` (chosen on validation for ~90 % AF sensitivity).

Files in `<AI_MODEL_DIR>/ecg/`: `ecg_rhythm.pt` (state dict) and `ecg_rhythm.json` (version, threshold, architecture).
"""

import json
import threading
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch
from torch import nn

MODEL_NAME = "ecg-rhythm"
WEIGHTS_FILE = "ecg_rhythm.pt"
META_FILE = "ecg_rhythm.json"
CLASSES = ("normal", "af", "other", "noisy")
LABELS = ("af_suspected", "no_af", "unclear")
SAMPLE_RATE = 250
WINDOW_S = 20
N_SAMPLES = SAMPLE_RATE * WINDOW_S
HIGH_PASS_HZ = (0.3, 0.7)  # raised-cosine ramp: blocked below 0.3 Hz, passed from 0.7 Hz (baseline wander)
LOW_PASS_HZ = (38.0, 45.0)  # passed up to 38 Hz, blocked from 45 Hz (muscle noise, 50 / 60 Hz mains)
MIN_SCALE_MV = 0.01  # a flat (lead-off) signal is not blown up to full scale
CLIP = 10.0


# --- preprocessing (shared by training and the server) ---


def resample(signal: np.ndarray, from_rate: float, to_rate: int = SAMPLE_RATE) -> np.ndarray:
    """Band-limited resampling in the frequency domain. The signal is mirrored at both ends first, so the FFT's
    wrap-around does not ring at the edges."""
    x = np.asarray(signal, dtype=np.float64)
    if from_rate == to_rate or len(x) < 2:
        return x.copy()
    pad = min(len(x) - 1, int(from_rate))  # 1 s of mirror
    padded = np.pad(x, pad, mode="reflect")
    n_out = round(len(padded) * to_rate / from_rate)
    spectrum = np.fft.rfft(padded)
    keep = min(len(spectrum), n_out // 2 + 1)
    out = np.fft.irfft(spectrum[:keep], n=n_out) * (n_out / len(padded))
    start = round(pad * to_rate / from_rate)
    return out[start : start + round(len(x) * to_rate / from_rate)]


def _ramp(f: np.ndarray, lo: float, hi: float) -> np.ndarray:
    """0 below lo, 1 above hi, a raised cosine in between."""
    t = np.clip((f - lo) / (hi - lo), 0.0, 1.0)
    return 0.5 - 0.5 * np.cos(np.pi * t)


def bandpass(x: np.ndarray, rate: int = SAMPLE_RATE) -> np.ndarray:
    """Zero-phase 0.5–40 Hz band-pass by FFT masking (mirror-padded by up to 2 s against edge ringing)."""
    x = np.asarray(x, dtype=np.float64)
    if len(x) < 2:
        return np.zeros_like(x)
    x = x - np.median(x)
    pad = min(len(x) - 1, 2 * rate)
    padded = np.pad(x, pad, mode="reflect")
    f = np.fft.rfftfreq(len(padded), 1.0 / rate)
    mask = _ramp(f, *HIGH_PASS_HZ) * (1.0 - _ramp(f, *LOW_PASS_HZ))
    return np.fft.irfft(np.fft.rfft(padded) * mask, n=len(padded))[pad : pad + len(x)]


def normalise(x: np.ndarray) -> np.ndarray:
    """Robust scale: centre on the median, divide by the 99th percentile of |x| (≈ the R-wave height), clip."""
    x = x - np.median(x) if len(x) else x
    scale = max(float(np.percentile(np.abs(x), 99)) if len(x) else 0.0, MIN_SCALE_MV)
    return np.clip(x / scale, -CLIP, CLIP)


def clean(window_mv: np.ndarray, rate: int = SAMPLE_RATE) -> np.ndarray:
    """A raw window at 250 Hz (≤ 20 s, mV) → band-passed, normalised, zero-padded to exactly 5000 float32 samples.
    Only the real samples are filtered and scaled; the padding stays 0."""
    x = np.nan_to_num(np.asarray(window_mv, dtype=np.float64)[:N_SAMPLES])
    out = np.zeros(N_SAMPLES, dtype=np.float32)
    out[: len(x)] = normalise(bandpass(x, rate))
    return out


def preprocess(signal_mv: np.ndarray, sample_rate: float) -> np.ndarray:
    """Any-rate 1-D signal in mV → the model input: (5000,) float32 = the first 20 s at 250 Hz, cleaned."""
    x = np.nan_to_num(np.asarray(signal_mv, dtype=np.float64).ravel())
    if sample_rate <= 0:
        raise ValueError("sample_rate must be positive")
    return clean(resample(x, sample_rate)[:N_SAMPLES])


# --- network ---


class ResBlock(nn.Module):
    def __init__(self, c_in: int, c_out: int, kernel: int, stride: int, dropout: float):
        super().__init__()
        pad = kernel // 2
        self.body = nn.Sequential(
            nn.Conv1d(c_in, c_out, kernel, stride, pad, bias=False),
            nn.BatchNorm1d(c_out),
            nn.ReLU(inplace=True),
            nn.Dropout(dropout),
            nn.Conv1d(c_out, c_out, kernel, 1, pad, bias=False),
            nn.BatchNorm1d(c_out),
        )
        self.skip = (
            nn.Identity()
            if c_in == c_out and stride == 1
            else nn.Sequential(nn.Conv1d(c_in, c_out, 1, stride, bias=False), nn.BatchNorm1d(c_out))
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return torch.relu(self.body(x) + self.skip(x))


class RhythmNet(nn.Module):
    """Stem (÷4) → stages of residual blocks (each stage ÷2) → mean + max over time → 4 class scores.
    Max pooling keeps a short (zero-padded) input from being diluted by the padding."""

    def __init__(
        self,
        widths: tuple[int, ...] = (32, 64, 96, 128),
        blocks: int = 2,
        kernel: int = 7,
        dropout: float = 0.1,
        n_classes: int = len(CLASSES),
    ):
        super().__init__()
        self.stem = nn.Sequential(
            nn.Conv1d(1, widths[0], 15, 2, 7, bias=False),
            nn.BatchNorm1d(widths[0]),
            nn.ReLU(inplace=True),
            nn.MaxPool1d(2),
        )
        layers, c_in = [], widths[0]
        for width in widths:
            for b in range(blocks):
                layers.append(ResBlock(c_in, width, kernel, 2 if b == 0 else 1, dropout))
                c_in = width
        self.stages = nn.Sequential(*layers)
        self.head = nn.Sequential(nn.Dropout(0.3), nn.Linear(2 * c_in, n_classes))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """(batch, 5000) or (batch, 1, 5000) → (batch, 4) logits."""
        if x.dim() == 2:
            x = x[:, None]
        h = self.stages(self.stem(x))
        return self.head(torch.cat([h.mean(dim=2), h.amax(dim=2)], dim=1))


# --- the decision the product shows ---


@dataclass(frozen=True)
class RhythmResult:
    label: str  # one of LABELS
    p_af: float
    model_name: str
    model_version: str


def decide(probs: np.ndarray, threshold: float) -> str:
    """4 class probabilities → product label: unclear if "noisy" wins, else AF when P(af) ≥ threshold."""
    if int(np.argmax(probs)) == CLASSES.index("noisy"):
        return "unclear"
    return "af_suspected" if probs[CLASSES.index("af")] >= threshold else "no_af"


class EcgRhythm:
    def __init__(self, net: RhythmNet, threshold: float, version: str, model_name: str = MODEL_NAME):
        self.net = net.eval()
        self.threshold = threshold
        self.version = version
        self.model_name = model_name
        self._lock = threading.Lock()  # one inference at a time (worker threads)

    def probabilities(self, windows: np.ndarray) -> np.ndarray:
        """Preprocessed windows (batch, 5000) → class probabilities (batch, 4)."""
        with self._lock, torch.inference_mode():
            return self.net(torch.from_numpy(np.asarray(windows, dtype=np.float32))).softmax(1).numpy()

    def predict(self, signal_mv: np.ndarray, sample_rate: int) -> RhythmResult:
        probs = self.probabilities(preprocess(signal_mv, sample_rate)[None])[0]
        return RhythmResult(
            label=decide(probs, self.threshold),
            p_af=round(float(probs[CLASSES.index("af")]), 4),
            model_name=self.model_name,
            model_version=self.version,
        )


def load(model_dir: Path) -> EcgRhythm | None:
    """The trained model from `model_dir` (ecg_rhythm.pt + ecg_rhythm.json), or None when either file is missing."""
    weights, meta_path = model_dir / WEIGHTS_FILE, model_dir / META_FILE
    if not (weights.is_file() and meta_path.is_file()):
        return None
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    arch = meta.get("arch", {})
    net = RhythmNet(
        widths=tuple(arch.get("widths", (32, 64, 96, 128))),
        blocks=arch.get("blocks", 2),
        kernel=arch.get("kernel", 7),
    )
    net.load_state_dict(torch.load(weights, map_location="cpu", weights_only=True))
    return EcgRhythm(net, float(meta["threshold"]), meta["model_version"], meta.get("model_name", MODEL_NAME))
