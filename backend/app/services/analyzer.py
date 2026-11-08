"""The analyzer interface. Real models (quality check, murmur classifier) will implement `Analyzer` later.

To plug in a real model: write a class with `name`, `version` and `analyze()`, then return it from `get_analyzer()`.
Every result is stored with `name` and `version`, so old results always show which model produced them.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol


@dataclass(frozen=True)
class AnalysisInput:
    wav_path: Path
    sample_rate: int
    duration_s: float
    motion_detected: bool


@dataclass(frozen=True)
class AnalysisResult:
    quality: str  # "good" / "bad" / "unknown"
    label: str  # "murmur" / "absent" = an answer; anything else (e.g. "not_analyzed") = no answer
    score: float | None  # model confidence 0..1, if the model gives one


# The answer vocabulary the website understands (frontend `aiOutcome()` mirrors it). A real model maps its output
# to these labels. Quality "bad" means the recording was too poor to judge, whatever the label says.
ANSWER_LABELS = frozenset({"murmur", "absent"})


def gave_answer(quality: str, label: str) -> bool:
    """Did the AI say murmur / no murmur? Only then is the doctor asked whether they agree with it."""
    return quality != "bad" and label in ANSWER_LABELS


class Analyzer(Protocol):
    name: str
    version: str

    def analyze(self, data: AnalysisInput) -> AnalysisResult: ...


class DummyAnalyzer:
    """Placeholder until a real model is chosen. Never claims anything about the heart sound."""

    name = "dummy"
    version = "0.1.0"

    def analyze(self, data: AnalysisInput) -> AnalysisResult:
        return AnalysisResult(quality="unknown", label="not_analyzed", score=None)


def get_analyzer() -> Analyzer:
    return DummyAnalyzer()
