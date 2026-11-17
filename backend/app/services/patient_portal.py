"""What a patient sees: own profile and own REVIEWED exams only. The AI's score, the model and the doctor's
agree / disagree never reach a patient; the yes/no label does, but only once the doctor has reviewed the exam."""

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AIResult, Device, Exam, ExamStatus, Patient, User, VitalSigns
from app.services import audit
from app.services.analyzer import gave_answer
from app.services.errors import NotFound


def _own_patient_record(db: Session, user: User) -> Patient:
    patient = db.scalar(select(Patient).where(Patient.user_id == user.id))
    if patient is None:
        raise NotFound("no patient record for this login")
    return patient


@dataclass(frozen=True)
class MyExamRow:
    id: int
    point: str
    created_at: datetime
    reviewed_at: datetime
    doctor_note: str
    doctor_name: str
    clinic: str | None
    device_code: str | None
    ai_label: str | None
    recording_quality: str | None


@dataclass(frozen=True)
class MyProfileData:
    patient: Patient
    latest_analysis: dict | None
    heart_rate: int | None
    heart_rate_at: datetime | None
    password_changed_at: datetime | None


def _reviewed_query(patient: Patient):
    return (
        select(Exam, Device, AIResult)
        .outerjoin(Device, Device.id == Exam.device_id)
        .outerjoin(AIResult, AIResult.exam_id == Exam.id)
        .where(Exam.patient_id == patient.id, Exam.status == ExamStatus.REVIEWED)
    )


def read_profile(db: Session, user: User) -> MyProfileData:
    patient = _own_patient_record(db, user)
    latest = db.execute(_reviewed_query(patient).order_by(Exam.reviewed_at.desc(), Exam.id.desc()).limit(1)).first()
    analysis = None
    if latest is not None:
        exam, device, _ = latest
        analysis = {
            "clinic": exam.clinic,
            "device_code": device.code if device else None,
            "at": exam.reviewed_at,
        }
    vitals = db.scalar(
        select(VitalSigns)
        .where(VitalSigns.patient_id == patient.id, VitalSigns.heart_rate.is_not(None))
        .order_by(VitalSigns.id.desc())
        .limit(1)
    )
    audit.record_read(db, user, "me.read", "patient", patient.id)
    return MyProfileData(
        patient,
        analysis,
        vitals.heart_rate if vitals else None,
        vitals.created_at if vitals else None,
        user.password_changed_at,
    )


def update_contact(db: Session, user: User, changes: dict) -> Patient:
    patient = _own_patient_record(db, user)
    for field, value in changes.items():
        setattr(patient, field, value)
    db.commit()
    audit.record(db, user, "me.update", "patient", patient.id)
    return patient


def _shown_ai_label(exam: Exam, ai: AIResult | None) -> str | None:
    """The AI's yes / no for the patient: only when it answered and the doctor did not disagree with it (owner,
    2026-11-17). A patient must never read "murmur" next to a doctor's note that says the heart is normal."""
    if ai is None or not gave_answer(ai.quality, ai.label) or exam.doctor_agrees_with_ai is False:
        return None
    return ai.label


def list_reviewed_exams(db: Session, user: User) -> list[MyExamRow]:
    patient = _own_patient_record(db, user)
    rows = [
        MyExamRow(
            id=exam.id,
            point=exam.point,
            created_at=exam.created_at,
            reviewed_at=exam.reviewed_at,
            doctor_note=exam.doctor_note or "",
            doctor_name=patient.doctor.full_name,
            clinic=exam.clinic,
            device_code=device.code if device else None,
            ai_label=_shown_ai_label(exam, ai),
            recording_quality=ai.quality if ai is not None else None,
        )
        for exam, device, ai in db.execute(_reviewed_query(patient).order_by(Exam.reviewed_at.desc()))
    ]
    audit.record_read(db, user, "me.exams.list", "patient", patient.id)
    return rows
