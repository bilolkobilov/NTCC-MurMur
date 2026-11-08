"""Exams as seen by their doctor: start, read, listen, review."""

from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.models import AuscultationPoint, Device, Exam, ExamStatus, Patient, User
from app.services import audit, exam_flow, storage
from app.services.errors import NotFound
from app.services.patients import get_patient_for_exam


def _own_device(db: Session, doctor: User, device_id: int) -> Device:
    device = db.get(Device, device_id)
    if device is None or device.doctor_id != doctor.id:
        raise NotFound("device not found")
    return device


def _own_exam(db: Session, doctor: User, exam_id: int, *, for_update: bool = False) -> Exam:
    if for_update:  # lock: an upload for the same exam waits until we commit
        exam = db.get(Exam, exam_id, with_for_update=True, populate_existing=True)
    else:
        # Recording and AI result come in the same query: the exam page polls this every ~2 s.
        exam = db.get(Exam, exam_id, options=[joinedload(Exam.recording), joinedload(Exam.ai_result)])
    if exam is None or exam.doctor_id != doctor.id:
        raise NotFound("exam not found")
    return exam


def start_exam(db: Session, doctor: User, patient_id: int, device_id: int, point: AuscultationPoint) -> Exam:
    patient = get_patient_for_exam(db, doctor, patient_id)
    device = _own_device(db, doctor, device_id)
    exam = exam_flow.create_exam(db, doctor, patient, device, point)
    audit.record(db, doctor, "exam.start", "exam", exam.id)  # the response shows the exam
    return exam


def read_exam(db: Session, doctor: User, exam_id: int) -> Exam:
    exam = _own_exam(db, doctor, exam_id)
    audit.record(db, doctor, "exam.read", "exam", exam.id)
    return exam


def exam_audio_path(db: Session, doctor: User, exam_id: int) -> Path:
    exam = _own_exam(db, doctor, exam_id)
    if exam.recording is None:
        raise NotFound("exam has no recording yet")
    path = storage.recording_path(exam.recording.file_name)
    if not path.is_file():
        raise NotFound("recording file is missing")
    audit.record(db, doctor, "exam.audio", "exam", exam.id)
    return path


def review_exam(db: Session, doctor: User, exam_id: int, note: str, agrees_with_ai: bool | None) -> Exam:
    exam = _own_exam(db, doctor, exam_id, for_update=True)  # a second, parallel review gets 409
    exam_flow.review(db, exam, note, agrees_with_ai)
    audit.record(db, doctor, "exam.review", "exam", exam.id)
    return exam


def cancel_exam(db: Session, doctor: User, exam_id: int) -> Exam:
    exam = _own_exam(db, doctor, exam_id, for_update=True)
    exam_flow.cancel(db, exam)
    audit.record(db, doctor, "exam.cancel", "exam", exam.id)
    return exam


def list_exams(
    db: Session, doctor: User, *, status: ExamStatus | None, limit: int, offset: int
) -> list[tuple[Exam, str]]:
    """The doctor's own exams across all patients, newest first, with the patient's name (e.g. "needs review")."""
    query = (
        select(Exam, Patient.full_name).join(Patient, Patient.id == Exam.patient_id).where(Exam.doctor_id == doctor.id)
    )
    if status is not None:
        query = query.where(Exam.status == status)
    rows = db.execute(query.order_by(Exam.created_at.desc(), Exam.id.desc()).limit(limit).offset(offset)).all()
    audit.record(db, doctor, "exam.list", "exam", None)
    return [(exam, name) for exam, name in rows]
