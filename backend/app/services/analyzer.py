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
    label: str  # e.g. "murmur" / "absent" / "not_analyzed"
    score: float | None  # model confidence 0..1, if the model gives one


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
