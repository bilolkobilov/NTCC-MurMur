"""Readers for the ECG rhythm data, written with numpy only (no wfdb / scipy: owner rule, 2026-11-17).

- PhysioNet/CinC Challenge 2017: MATLAB v4 `.mat` (one row of int16 samples) + `.hea` header, 300 Hz, one lead.
- PTB-XL 1.0.3: WFDB format 16 `.dat` (12 interleaved little-endian int16 channels) + `.hea`, 500 Hz; we use lead II.
Both return the signal in mV (sample / gain, after subtracting the baseline) as float32.
"""

import csv
import struct
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
sys.path.insert(0, str(REPO / "backend"))  # the model code lives in the backend app

SAMPLES = REPO / "samples" / "ecg"
CINC_DIR = SAMPLES / "cinc2017"  # training2017/ + REFERENCE-v3.csv
PTBXL_DIR = SAMPLES / "ptbxl"  # ptbxl_database.csv, scp_statements.csv, records500/...
MODEL_DIR = REPO / "models" / "ecg"
SPLIT_DIR = HERE / "split"
RESULTS = REPO / "docs" / "specs" / "ecg-ai-results.md"

CLASSES = ("normal", "af", "other", "noisy")  # model output order (same as app.services.ai.ecg_rhythm)
CINC_LABEL = {"N": "normal", "A": "af", "O": "other", "~": "noisy"}


@dataclass(frozen=True)
class Header:
    rate: float
    n_samples: int
    leads: list[str]
    gains: list[float]  # ADC units per mV
    baselines: list[int]
    fmt: list[str]


def read_header(path: Path) -> Header:
    """A WFDB `.hea`: first line `name n_sig rate n_samples`, then one line per signal
    `file format gain(baseline)/units adc_res adc_zero init_value checksum block_size description`."""
    lines = [ln.strip() for ln in path.read_text(encoding="ascii").splitlines() if ln.strip() and ln[0] != "#"]
    first = lines[0].split()
    n_sig, rate, n_samples = int(first[1]), float(first[2].split("/")[0]), int(first[3])
    leads, gains, baselines, fmts = [], [], [], []
    for line in lines[1 : 1 + n_sig]:
        parts = line.split()
        fmts.append(parts[1].split("x")[0].split(":")[0].split("+")[0])
        gain_field = parts[2].split("/")[0]  # e.g. "1000(0)" or "1000"
        if "(" in gain_field:
            gain, base = gain_field.rstrip(")").split("(")
            baselines.append(int(base))
        else:
            gain = gain_field
            baselines.append(int(parts[4]) if len(parts) > 4 else 0)  # baseline defaults to adc_zero
        gains.append(float(gain) or 200.0)  # WFDB: gain 0 means the default 200 units/mV
        leads.append(parts[-1])
    return Header(rate, n_samples, leads, gains, baselines, fmts)


_MAT4_TYPES = {0: "<f8", 1: "<f4", 2: "<i4", 3: "<i2", 4: "<u2", 5: "<u1"}


def read_mat_v4(path: Path) -> np.ndarray:
    """The first matrix of a MATLAB level-4 file as a flat array (CinC 2017 stores `val`, 1 x n int16).
    Header: 5 little-endian int32 = type (M*1000 + O*100 + P*10 + T), rows, cols, imaginary flag, name length."""
    raw = path.read_bytes()
    mopt, rows, cols, imag, namelen = struct.unpack_from("<5i", raw, 0)
    machine, precision, kind = mopt // 1000, (mopt // 10) % 10, mopt % 10
    if machine != 0 or kind != 0 or imag != 0 or precision not in _MAT4_TYPES:
        raise ValueError(f"{path.name}: unsupported MATLAB v4 matrix (type {mopt}, imaginary {imag})")
    dtype = np.dtype(_MAT4_TYPES[precision])
    start = 20 + namelen
    data = np.frombuffer(raw, dtype=dtype, count=rows * cols, offset=start)
    return data.reshape(cols, rows).T.ravel()  # column-major; a 1 x n row stays in order


def read_cinc(record: str) -> tuple[np.ndarray, int]:
    """One CinC 2017 record (e.g. "A00001") → (signal in mV, 300)."""
    base = CINC_DIR / "training2017" / record
    header = read_header(base.with_suffix(".hea"))
    adc = read_mat_v4(base.with_suffix(".mat")).astype(np.float64)
    mv = (adc - header.baselines[0]) / header.gains[0]
    return mv.astype(np.float32), round(header.rate)


def cinc_labels() -> dict[str, str]:
    """Record → class name. REFERENCE-v3.csv is the challenge's final, re-reviewed label set (the zip's own
    REFERENCE.csv is the original one); both are kept on disk, v3 is used."""
    path = CINC_DIR / "REFERENCE-v3.csv"
    with open(path, encoding="ascii", newline="") as handle:
        return {row[0]: CINC_LABEL[row[1]] for row in csv.reader(handle) if row}


def read_wfdb16(base: Path, lead: str = "II") -> tuple[np.ndarray, int]:
    """One lead of a WFDB format-16 record (PTB-XL `records500/…/xxxxx_hr`) → (signal in mV, rate)."""
    header = read_header(base.with_suffix(".hea"))
    if set(header.fmt) != {"16"}:
        raise ValueError(f"{base.name}: only WFDB format 16 is supported, got {header.fmt}")
    i = header.leads.index(lead)
    n_sig = len(header.leads)
    adc = np.fromfile(base.with_suffix(".dat"), dtype="<i2")
    adc = adc[: (len(adc) // n_sig) * n_sig].reshape(-1, n_sig)[:, i].astype(np.float64)
    mv = (adc - header.baselines[i]) / header.gains[i]
    return mv.astype(np.float32), round(header.rate)


def read_ids(name: str) -> list[str]:
    """A committed ID list from split/ (one record per line)."""
    return [ln.strip() for ln in (SPLIT_DIR / name).read_text(encoding="ascii").splitlines() if ln.strip()]


def ptbxl_records() -> list[tuple[str, str, str]]:
    """The PTB-XL external test set from split/ptbxl_fold10.csv: (ecg_id, file base relative to PTBXL_DIR, label)."""
    with open(SPLIT_DIR / "ptbxl_fold10.csv", encoding="ascii", newline="") as handle:
        return [(row["ecg_id"], row["filename_hr"], row["label"]) for row in csv.DictReader(handle)]
