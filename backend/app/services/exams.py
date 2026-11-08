"""Exams as seen by their doctor: start, read, listen, review."""

from pathlib import Path

from sqlalchemy.orm import Session

from app.models import AuscultationPoint, Device, Exam, User
from app.services import audit, exam_flow, storage
from app.services.errors import NotFound
from app.services.patients import get_patient_for_exam


def _own_device(db: Session, doctor: User, device_id: int) -> Device:
    device = db.get(Device, device_id)
    if device is None or device.doctor_id != doctor.id:
        raise NotFound("device not found")
    return device


def _own_exam(db: Session, doctor: User, exam_id: int) -> Exam:
    exam = db.get(Exam, exam_id)
    if exam is None or exam.doctor_id != doctor.id:
        raise NotFound("exam not found")
    return exam


def start_exam(db: Session, doctor: User, patient_id: int, device_id: int, point: AuscultationPoint) -> Exam:
    patient = get_patient_for_exam(db, doctor, patient_id)
    device = _own_device(db, doctor, device_id)
    return exam_flow.create_exam(db, doctor, patient, device, point)


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


def review_exam(db: Session, doctor: User, exam_id: int, note: str, agrees_with_ai: bool) -> Exam:
    exam = _own_exam(db, doctor, exam_id)
    return exam_flow.review(db, exam, note, agrees_with_ai)
