"""CirCor DigiScope 1.0.3 for training and testing the murmur head (docs/specs/2026-11-08-ai-model.md).

Data: samples/circor/the-circor-digiscope-phonocardiogram-dataset-1.0.3 (ODC-By, never committed).
Labels per recording (we record one point per exam; CirCor labels the patient and lists murmur points):
  patient Absent → absent · patient Unknown → unknown · patient Present and this point in "Murmur locations" →
  present · patient Present, other point → left out (ambiguous: murmur not marked audible there).
"""

import csv
import json
import random
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "backend"))  # the encoder lives in the backend app

from app.services.ai import cardiophon  # noqa: E402

DATA = REPO / "samples" / "circor" / "the-circor-digiscope-phonocardiogram-dataset-1.0.3"
MODEL_DIR = REPO / "models"
OUT = MODEL_DIR / "cardiophon"
SEED = 2026
TEST_SHARE = 0.2


@dataclass(frozen=True)
class Recording:
    file: Path
    patient: str
    point: str
    label: str  # one of cardiophon.CLASSES


def recordings() -> list[Recording]:
    patients = {row["Patient ID"]: row for row in csv.DictReader(open(DATA / "training_data.csv", encoding="utf-8"))}
    found = []
    for wav in sorted((DATA / "training_data").glob("*.wav")):
        patient, point = wav.stem.split("_")[:2]
        row = patients[patient]
        if row["Murmur"] == "Absent":
            label = "absent"
        elif row["Murmur"] == "Unknown":
            label = "unknown"
        elif point in row["Murmur locations"].split("+"):
            label = "present"
        else:
            continue
        found.append(Recording(wav, patient, point, label))
    return found


def patient_label(recs: list[Recording]) -> dict[str, str]:
    return {r.patient: r.label for r in recs}  # every kept recording of a patient has the patient's label


def test_patients(recs: list[Recording]) -> set[str]:
    """A fixed 20 % of patients per label group (seeded): no patient is ever in both training and test."""
    by_label: dict[str, list[str]] = {}
    for patient, label in sorted(patient_label(recs).items()):
        by_label.setdefault(label, []).append(patient)
    rng = random.Random(SEED)
    test: set[str] = set()
    for patients in by_label.values():
        rng.shuffle(patients)
        test.update(patients[: round(len(patients) * TEST_SHARE)])
    return test


def embeddings(recs: list[Recording]) -> dict[str, np.ndarray]:
    """3072 numbers per recording, computed once and cached in models/cardiophon/embeddings.npz."""
    cache = OUT / "embeddings.npz"
    stored = dict(np.load(cache)) if cache.exists() else {}
    missing = [r for r in recs if r.file.name not in stored]
    if missing:
        import torch

        torch.manual_seed(SEED)
        encoder = cardiophon.Encoder(MODEL_DIR)
        for i, rec in enumerate(missing, 1):
            audio, rate = cardiophon.read_wav(rec.file)
            if rate != cardiophon.SAMPLE_RATE:
                raise ValueError(f"{rec.file.name}: {rate} Hz")
            stored[rec.file.name] = encoder.embed(audio)
            if i % 250 == 0 or i == len(missing):
                print(f"  embedded {i}/{len(missing)}")
        np.savez_compressed(cache, **stored)
    return stored


def save_json(path: Path, data: object) -> None:
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
