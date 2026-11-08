"""The analyzer interface and the switch between models (setting `AI_MODEL`).

`DummyAnalyzer` (default) never claims anything; `CardiophonAnalyzer` (services/ai/cardiophon.py) is the real murmur
model. Another model: a class with `name`, `version` and `analyze()`, built in `_build()`.
Every result is stored with `name` and `version`, so old results always show which model produced them.
"""

import logging
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from app.config import Settings, get_settings

log = logging.getLogger(__name__)


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


_lock = threading.Lock()
_instance: Analyzer | None = None


def get_analyzer() -> Analyzer:
    """The configured analyzer, built once (loading a real model takes seconds) and shared by all analyses."""
    global _instance
    with _lock:
        if _instance is None:
            _instance = _build(get_settings())
        return _instance


def _build(settings: Settings) -> Analyzer:
    if settings.ai_model == "cardiophon":
        try:
            from app.services.ai.cardiophon import CardiophonAnalyzer  # needs the optional `ai` group

            analyzer = CardiophonAnalyzer(settings.ai_model_path)
            log.info("AI model loaded: %s %s", analyzer.name, analyzer.version)
            return analyzer
        except Exception:
            log.exception("AI_MODEL=cardiophon but the model could not be loaded; using the dummy analyzer")
    return DummyAnalyzer()
