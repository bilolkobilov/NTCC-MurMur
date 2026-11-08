"""Patients as seen by their doctor. Every read of patient data is written to the audit log."""

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Exam, Patient, Role, Sex, User
from app.security import generate_temp_password
from app.services import audit
from app.services.errors import Conflict, NotFound
from app.services.users import create_user


def create_patient(
    db: Session,
    doctor: User,
    *,
    full_name: str,
    birth_year: int,
    sex: Sex,
    height_cm: float | None,
    weight_kg: float | None,
    consent_given: bool,
) -> Patient:
    patient = Patient(
        doctor_id=doctor.id,
        full_name=full_name,
        birth_year=birth_year,
        sex=sex,
        height_cm=height_cm,
        weight_kg=weight_kg,
        consent_given_at=datetime.now(UTC) if consent_given else None,
    )
    db.add(patient)
    db.commit()
    return patient


def _own_patient(db: Session, doctor: User, patient_id: int) -> Patient:
    """Another doctor's patient looks exactly like a missing one (404), so ids of others are not revealed."""
    patient = db.get(Patient, patient_id)
    if patient is None or patient.doctor_id != doctor.id:
        raise NotFound("patient not found")
    return patient


def list_patients(db: Session, doctor: User) -> list[Patient]:
    patients = list(db.scalars(select(Patient).where(Patient.doctor_id == doctor.id).order_by(Patient.id)))
    audit.record(db, doctor, "patient.list", "patient", None)
    return patients


def read_patient(db: Session, doctor: User, patient_id: int) -> Patient:
    patient = _own_patient(db, doctor, patient_id)
    audit.record(db, doctor, "patient.read", "patient", patient.id)
    return patient


def get_patient_for_exam(db: Session, doctor: User, patient_id: int) -> Patient:
    """Ownership check without an audit row (creating an exam is a write, not a read)."""
    return _own_patient(db, doctor, patient_id)


def record_consent(db: Session, doctor: User, patient_id: int) -> Patient:
    patient = _own_patient(db, doctor, patient_id)
    if patient.consent_given_at is None:
        patient.consent_given_at = datetime.now(UTC)
        db.commit()
    return patient


def create_patient_login(db: Session, doctor: User, patient_id: int, username: str) -> tuple[User, str]:
    """Returns the new login and its temporary password (shown once; the patient must change it)."""
    patient = _own_patient(db, doctor, patient_id)
    if patient.user_id is not None:
        raise Conflict("patient already has a login")
    temp_password = generate_temp_password()
    user = create_user(
        db,
        username=username,
        password=temp_password,
        role=Role.PATIENT,
        full_name=patient.full_name,
        must_change_password=True,
    )
    patient.user_id = user.id
    db.commit()
    return user, temp_password


def list_patient_exams(db: Session, doctor: User, patient_id: int) -> list[Exam]:
    patient = _own_patient(db, doctor, patient_id)
    exams = list(db.scalars(select(Exam).where(Exam.patient_id == patient.id).order_by(Exam.id.desc())))
    audit.record(db, doctor, "patient.exams.list", "patient", patient.id)
    return exams
