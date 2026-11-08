"""Background job run after an upload: analyze the WAV and store the result.

Runs as a FastAPI BackgroundTask after the response is sent, so it opens its own database session.
"""

import logging

from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models import AIResult, Exam, ExamStatus
from app.services import analyzer as analyzer_module
from app.services import exam_flow, storage

log = logging.getLogger(__name__)


def run_analysis(exam_id: int) -> None:
    with SessionLocal() as db:
        exam = db.get(Exam, exam_id)
        if exam is None or exam.status != ExamStatus.UPLOADED or exam.recording is None:
            log.warning("analysis skipped for exam %s: not in 'uploaded' state", exam_id)
            return
        recording = exam.recording
        model = analyzer_module.get_analyzer()
        try:
            result = model.analyze(
                analyzer_module.AnalysisInput(
                    wav_path=storage.recording_path(recording.file_name),
                    sample_rate=recording.sample_rate,
                    duration_s=recording.duration_s,
                    motion_detected=recording.motion_detected,
                )
            )
        except Exception as exc:  # any model error must end as a visible 'failed' exam, not a stuck one
            log.exception("analysis failed for exam %s", exam_id)
            _fail(db, exam_id, f"analysis error: {type(exc).__name__}")
            return

        try:
            db.add(
                AIResult(
                    exam_id=exam.id,
                    model_name=model.name,
                    model_version=model.version,
                    quality=result.quality,
                    label=result.label,
                    score=result.score,
                )
            )
            exam_flow.mark_analyzed(exam)
            db.commit()
        except Exception as exc:  # e.g. a value too long for its column, or the database went away
            log.exception("could not store analysis result for exam %s", exam_id)
            db.rollback()
            _fail(db, exam_id, f"could not store analysis result: {type(exc).__name__}")


def _fail(db: Session, exam_id: int, reason: str) -> None:
    exam = db.get(Exam, exam_id, populate_existing=True)
    if exam is None:  # the patient was deleted while the analysis ran
        return
    exam_flow.mark_failed(exam, reason)
    db.commit()
