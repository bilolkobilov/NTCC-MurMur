"""Background job run after an upload: analyze the WAV and store the result.

Runs as a FastAPI BackgroundTask after the response is sent, so it opens its own database session.
"""

import logging

from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models import AIResult, EcgResult, Exam, ExamStatus
from app.services import analyzer as analyzer_module
from app.services import ecg, exam_flow, quality, storage

log = logging.getLogger(__name__)


def run_analysis(exam_id: int) -> None:
    with SessionLocal() as db:
        exam = db.get(Exam, exam_id)
        if exam is None or exam.status != ExamStatus.UPLOADED or exam.recording is None:
            log.warning("analysis skipped for exam %s: not in 'uploaded' state", exam_id)
            return
        recording = exam.recording
        wav_path = storage.recording_path(recording.file_name)
        if exam.ecg_recording is not None and exam.ecg_result is None:
            _analyze_ecg(db, exam)

        # 1. quality rules first: a bad recording is never shown to the AI (PLAN.md 5.1)
        try:
            bad = quality.problems(quality.measure(wav_path, recording.duration_s), recording.motion_detected)
        except Exception as exc:
            log.exception("quality check failed for exam %s", exam_id)
            _fail(db, exam_id, f"quality check error: {type(exc).__name__}")
            return
        if bad:
            _fail(db, exam_id, "re-record: " + "; ".join(bad))
            return

        # 2. the analyzer
        model = analyzer_module.get_analyzer()
        try:
            result = model.analyze(
                analyzer_module.AnalysisInput(
                    wav_path=wav_path,
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


def _analyze_ecg(db: Session, exam: Exam) -> None:
    """Measure the ECG and store it. Whatever happens here, the sound analysis still runs: a bad or broken ECG only
    makes the ECG part say "cannot judge", it never fails the exam (owner, 2026-11-17)."""
    rec = exam.ecg_recording
    try:
        source = ecg.EcgInput(
            storage.recording_path(rec.file_name).read_bytes(),
            rec.channels,
            rec.sample_rate,
            rec.gain,
            rec.vref_mv,
            rec.lead_off,
        )
        measured = ecg.analyze(source)
        row = EcgResult(
            exam_id=exam.id,
            method_version=ecg.METHOD_VERSION,
            quality=measured.quality,
            problem=measured.problem,
            channel=measured.channel,
            heart_rate=measured.heart_rate,
            rr_cv=measured.rr_cv,
            beats=measured.beats,
            snr=measured.snr,
            r_peaks_s=measured.r_peaks_s,
        )
        model = ecg.get_rhythm_model()
        if model is not None and measured.quality == "good":
            import numpy as np  # only with the AI group installed, which the model needs anyway

            rhythm = model.predict(np.asarray(ecg.channel_mv(source, measured.channel)), rec.sample_rate)
            row.rhythm_label = rhythm.label
            row.rhythm_p_af = round(float(rhythm.p_af), 4)
            row.rhythm_model_name = rhythm.model_name
            row.rhythm_model_version = rhythm.model_version
    except Exception:
        log.exception("ECG analysis failed for exam %s", exam.id)
        db.rollback()
        row = EcgResult(exam_id=exam.id, method_version=ecg.METHOD_VERSION, quality="bad", problem=ecg.ERROR)
    db.add(row)
    db.commit()


def _fail(db: Session, exam_id: int, reason: str) -> None:
    exam = db.get(Exam, exam_id, populate_existing=True)
    if exam is None:  # the patient was deleted while the analysis ran
        return
    exam_flow.mark_failed(exam, reason)
    db.commit()
