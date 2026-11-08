"""What a patient sees: own profile and own REVIEWED exams only. Raw AI results are never shown to patients."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Exam, ExamStatus, Patient, User
from app.services import audit
from app.services.errors import NotFound


def _own_patient_record(db: Session, user: User) -> Patient:
    patient = db.scalar(select(Patient).where(Patient.user_id == user.id))
    if patient is None:
        raise NotFound("no patient record for this login")
    return patient


def read_profile(db: Session, user: User) -> Patient:
    patient = _own_patient_record(db, user)
    audit.record(db, user, "me.read", "patient", patient.id)
    return patient


def list_reviewed_exams(db: Session, user: User) -> list[Exam]:
    patient = _own_patient_record(db, user)
    exams = list(
        db.scalars(
            select(Exam)
            .where(Exam.patient_id == patient.id, Exam.status == ExamStatus.REVIEWED)
            .order_by(Exam.reviewed_at.desc())
        )
    )
    audit.record(db, user, "me.exams.list", "patient", patient.id)
    return exams
