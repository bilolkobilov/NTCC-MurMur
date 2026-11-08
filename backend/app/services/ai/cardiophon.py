"""CardioPHON audio encoder: a heart-sound recording → one vector of 3072 numbers ("embedding").

Needs the optional `ai` dependency group (`uv sync --group ai`) and the weights file
`<AI_MODEL_DIR>/cardiophon/pretrained_physionet_2022_4kHz.pth` (docs/runbook.md). Nothing here is imported by the
server unless the CardioPHON analyzer is switched on, so the default install never needs PyTorch.

Sources (owner decision 2026-11-08: use with citation, weights never committed):
- CardioPHON: V. Despotovic, P. Pocta, A. Zgank, Biomedical Signal Processing and Control 113 (2026) 109047,
  https://git.lih.lu/vdespotovic/cardiophon — weights and front-end settings (config_4k.yaml, physionet_2022.py).
- The network is BYOL-A v2 `AudioNTT2022` (D. Niizumi et al., IJCNN 2021), MIT licence, Copyright (c) 2021 NTT
  Communication Science Laboratories, https://github.com/nttcslab/byol-a — ported below.
- The log-mel front end re-implements nnAudio's MelSpectrogram with plain torch (checked to match, see tests).
"""

import json
import math
import threading
import wave
from pathlib import Path

import numpy as np
import torch
from torch import nn

from app.services.analyzer import AnalysisInput, AnalysisResult

SAMPLE_RATE = 4000  # the encoder was trained on 4 kHz audio (CirCor's own rate)
N_FFT = 512
HOP = 160
N_MELS = 64
F_MIN = 60.0
F_MAX = 2000.0
FEATURE_D = 3072
# Mean and standard deviation of the log-mel values, fixed in CardioPHON's script (training subset).
NORM_MEAN, NORM_STD = -4.1357055, 2.863227
WEIGHTS_FILE = "pretrained_physionet_2022_4kHz.pth"


# --- BYOL-A v2 network (MIT, NTT) ---


def _mean_max_pooling(frames: torch.Tensor) -> torch.Tensor:
    return frames.max(dim=1).values + frames.mean(dim=1)  # (batch, time, d) → (batch, d)


class AudioNTT2022(nn.Module):
    """2 conv blocks over the log-mel image + an MLP per time frame, stacked; pooled over time."""

    def __init__(self, n_mels: int = N_MELS, d: int = FEATURE_D, base_d: int = 64, mlp_hidden_d: int = 2048):
        super().__init__()
        self.features = nn.Sequential(
            nn.Conv2d(1, base_d, 3, stride=1, padding=1),
            nn.BatchNorm2d(base_d),
            nn.ReLU(),
            nn.MaxPool2d(2, stride=2),
            nn.Conv2d(base_d, base_d, 3, stride=1, padding=1),
            nn.BatchNorm2d(base_d),
            nn.ReLU(),
            nn.MaxPool2d(2, stride=2),
        )
        conv_d = base_d * (n_mels // 4)
        self.fc = nn.Sequential(
            nn.Linear(conv_d, mlp_hidden_d),
            nn.ReLU(),
            nn.Dropout(p=0.3),
            nn.Linear(mlp_hidden_d, d - conv_d),
            nn.ReLU(),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.features(x)  # (batch, ch, mel, time)
        x = x.permute(0, 3, 2, 1)  # (batch, time, mel, ch)
        b, t, d, c = x.shape
        x = x.reshape((b, t, c * d))
        x = torch.cat([x, self.fc(x)], dim=2)  # (batch, time, conv_d + fc_d)
        return _mean_max_pooling(x)


# --- log-mel front end (same numbers as nnAudio MelSpectrogram(center=True, power=2), Slaney mel scale) ---


def _hz_to_mel(hz: np.ndarray) -> np.ndarray:
    f_sp = 200.0 / 3
    mels = hz / f_sp
    min_log_hz, min_log_mel, logstep = 1000.0, 1000.0 / f_sp, math.log(6.4) / 27.0
    return np.where(hz >= min_log_hz, min_log_mel + np.log(np.maximum(hz, 1e-10) / min_log_hz) / logstep, mels)


def _mel_to_hz(mels: np.ndarray) -> np.ndarray:
    f_sp = 200.0 / 3
    min_log_hz, min_log_mel, logstep = 1000.0, 1000.0 / f_sp, math.log(6.4) / 27.0
    return np.where(mels >= min_log_mel, min_log_hz * np.exp(logstep * (mels - min_log_mel)), f_sp * mels)


def mel_filterbank(sr: int = SAMPLE_RATE, n_fft: int = N_FFT, n_mels: int = N_MELS) -> torch.Tensor:
    """Triangular Slaney-normalised mel filters, shape (n_mels, n_fft // 2 + 1)."""
    fft_freqs = np.linspace(0, sr / 2, n_fft // 2 + 1)
    mel_f = _mel_to_hz(np.linspace(_hz_to_mel(np.array(F_MIN)), _hz_to_mel(np.array(F_MAX)), n_mels + 2))
    fdiff = np.diff(mel_f)
    ramps = mel_f[:, None] - fft_freqs[None, :]
    lower = -ramps[:-2] / fdiff[:-1, None]
    upper = ramps[2:] / fdiff[1:, None]
    weights = np.maximum(0, np.minimum(lower, upper))
    weights *= (2.0 / (mel_f[2 : n_mels + 2] - mel_f[:n_mels]))[:, None]
    return torch.from_numpy(weights.astype(np.float32))


_MEL = mel_filterbank()
_WINDOW = torch.hann_window(N_FFT, periodic=True)


def log_mel(audio: torch.Tensor) -> torch.Tensor:
    """Mono 4 kHz audio (samples,) → normalised log-mel image (64, frames)."""
    spec = torch.stft(audio, N_FFT, HOP, N_FFT, _WINDOW, center=True, pad_mode="reflect", return_complex=True)
    mel = _MEL @ spec.abs().pow(2)
    return ((mel + torch.finfo(torch.float).eps).log() - NORM_MEAN) / NORM_STD


# --- audio in ---


def read_wav(path: Path) -> tuple[torch.Tensor, int]:
    """16-bit PCM WAV → mono float tensor in [-1, 1) and its sample rate (channels averaged)."""
    with wave.open(str(path), "rb") as wav:
        if wav.getsampwidth() != 2:
            raise ValueError("only 16-bit PCM WAV is supported")
        rate, channels = wav.getframerate(), wav.getnchannels()
        samples = np.frombuffer(wav.readframes(wav.getnframes()), dtype="<i2").astype(np.float32) / 32768.0
    if channels > 1:
        samples = samples.reshape(-1, channels).mean(axis=1)
    return torch.from_numpy(samples.copy()), rate


# --- our murmur head (trained by scripts/ai/train_head.py on CirCor, patient-level split) ---

CLASSES = ("present", "absent", "unknown")  # index → CirCor murmur label for one recording
HEAD_FILE = "murmur_head.pt"


class Standardize(nn.Module):
    """Zero mean, unit variance per number, with the training set's statistics (CardioPHON's `standardize`).
    Stored inside the head file, so the server scales exactly like training did."""

    def __init__(self, d: int):
        super().__init__()
        self.register_buffer("mean", torch.zeros(d))
        self.register_buffer("std", torch.ones(d))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return (x - self.mean) / self.std


def murmur_head(arch: str = "mlp", n_classes: int = len(CLASSES), input_d: int = FEATURE_D) -> nn.Sequential:
    """Standardize, then "mlp" = CardioPHON's `train_mlp` (3072 → 256 → 256 → n) or "linear" (logistic regression)."""
    if arch == "linear":
        return nn.Sequential(Standardize(input_d), nn.Linear(input_d, n_classes))
    if arch != "mlp":
        raise ValueError(f"unknown head architecture {arch!r}")
    return nn.Sequential(
        Standardize(input_d),
        nn.Linear(input_d, 256),
        nn.Dropout(0.5),
        nn.ReLU(),
        nn.Linear(256, 256),
        nn.Dropout(0.5),
        nn.ReLU(),
        nn.Linear(256, n_classes),
    )


def resample(audio: torch.Tensor, from_rate: int, to_rate: int = SAMPLE_RATE) -> torch.Tensor:
    """Band-limited resampling in the frequency domain (keeps everything below the new Nyquist frequency).
    The ESP32 may record at 8 or 16 kHz; the encoder needs 4 kHz."""
    if from_rate == to_rate:
        return audio
    n_out = round(len(audio) * to_rate / from_rate)
    spectrum = torch.fft.rfft(audio)
    keep = min(len(spectrum), n_out // 2 + 1)
    return torch.fft.irfft(spectrum[:keep], n=n_out) * (n_out / len(audio))


class Encoder:
    """Loads the network once; `embed()` is safe to call from one thread at a time (the analyzer holds a lock)."""

    def __init__(self, model_dir: Path):
        self.model = AudioNTT2022()
        state = torch.load(model_dir / "cardiophon" / WEIGHTS_FILE, map_location="cpu", weights_only=True)
        self.model.load_state_dict(state)
        self.model.eval()

    @torch.inference_mode()
    def embed(self, audio: torch.Tensor) -> np.ndarray:
        """4 kHz mono audio → 3072 numbers (the whole recording at once)."""
        return self.model(log_mel(audio)[None, None]).squeeze(0).numpy()

    @torch.inference_mode()
    def embed_windows(self, audio: torch.Tensor, window_s: float, hop_s: float) -> np.ndarray:
        """4 kHz mono audio → one row of 3072 numbers per window (window_s long, every hop_s; an uncovered tail
        longer than half a hop gets a last window ending at the end). Shorter than one window → one row."""
        image = log_mel(audio)
        width, step, frames = round(window_s * SAMPLE_RATE / HOP), round(hop_s * SAMPLE_RATE / HOP), image.shape[1]
        if frames <= width:
            return self.model(image[None, None]).numpy()
        starts = list(range(0, frames - width + 1, step))
        if frames - (starts[-1] + width) > step // 2:  # a tail longer than half a step gets its own window
            starts.append(frames - width)
        return self.model(torch.stack([image[:, s : s + width] for s in starts])[:, None]).numpy()


# --- the analyzer the server runs after an upload ---


class CardiophonAnalyzer:
    """Encoder + murmur head, configured by murmur_head.json (written by scripts/ai/train_head.py):
    classes   ("present", "absent") or ("present", "absent", "unknown")
    arch      head architecture, see `murmur_head`
    window_s  null = whole recording; else windows of that length (half-overlapping), probabilities averaged
    threshold P(present) at which "murmur" is said (chosen for ~80 % sensitivity, owner 2026-11-08); null = argmax
    Answers: murmur / absent (quality good), or unknown (quality bad = "too poor to judge", 3-class heads only).
    The score is always P(murmur), so the doctor sees one comparable number ("murmur probability")."""

    name = "cardiophon-murmur"

    def __init__(self, model_dir: Path):
        meta = json.loads((model_dir / "cardiophon" / "murmur_head.json").read_text(encoding="utf-8"))
        self.version: str = meta["model_version"]
        self.classes: list[str] = meta.get("classes", list(CLASSES))
        self.window_s: float | None = meta.get("window_s")
        self.threshold: float | None = meta.get("threshold")
        self.encoder = Encoder(model_dir)
        self.head = murmur_head(meta.get("arch", "mlp"), len(self.classes))
        self.head.load_state_dict(
            torch.load(model_dir / "cardiophon" / HEAD_FILE, map_location="cpu", weights_only=True)
        )
        self.head.eval()
        self._lock = threading.Lock()  # uploads are analysed in worker threads; one inference at a time

    def analyze(self, data: AnalysisInput) -> AnalysisResult:
        audio, rate = read_wav(data.wav_path)
        audio = resample(audio, rate)
        with self._lock, torch.inference_mode():
            if self.window_s:
                rows = self.encoder.embed_windows(audio, self.window_s, self.window_s / 2)
            else:
                rows = self.encoder.embed(audio)[None]
            probs = self.head(torch.from_numpy(rows)).softmax(1).mean(0)
        p = {name: float(probs[i]) for i, name in enumerate(self.classes)}
        flagged = p["present"] >= self.threshold if self.threshold is not None else max(p, key=p.get) == "present"
        score = round(p["present"], 4)
        if flagged:
            return AnalysisResult(quality="good", label="murmur", score=score)
        if p.get("unknown", 0.0) > p["absent"]:
            return AnalysisResult(quality="bad", label="unknown", score=score)
        return AnalysisResult(quality="good", label="absent", score=score)
