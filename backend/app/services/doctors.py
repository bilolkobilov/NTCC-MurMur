"""Doctor accounts, managed by the admin."""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Patient, Role, User
from app.services.errors import NotFound
from app.services.users import create_user, set_password


def create_doctor(db: Session, *, username: str, password: str, full_name: str, clinic: str | None = None) -> User:
    """Admin sets the doctor's password; no forced change (owner decision 2026-11-08)."""
    doctor = create_user(db, username=username, password=password, role=Role.DOCTOR, full_name=full_name)
    doctor.clinic = clinic
    db.commit()
    return doctor


def list_doctors(db: Session) -> list[tuple[User, int]]:
    """Doctors with their patient count (a number only — admin never sees patient data)."""
    patient_count = select(Patient.doctor_id, func.count().label("n")).group_by(Patient.doctor_id).subquery()
    rows = db.execute(
        select(User, func.coalesce(patient_count.c.n, 0))
        .outerjoin(patient_count, patient_count.c.doctor_id == User.id)
        .where(User.role == Role.DOCTOR)
        .order_by(User.id)
    )
    return [(user, count) for user, count in rows]


def get_doctor(db: Session, doctor_id: int) -> User:
    doctor = db.get(User, doctor_id)
    if doctor is None or doctor.role != Role.DOCTOR:
        raise NotFound("doctor not found")
    return doctor


def set_doctor_clinic(db: Session, doctor_id: int, clinic: str | None) -> User:
    doctor = get_doctor(db, doctor_id)
    doctor.clinic = clinic
    db.commit()
    return doctor


def set_doctor_active(db: Session, doctor_id: int, active: bool) -> User:
    doctor = get_doctor(db, doctor_id)
    doctor.is_active = active
    db.commit()
    return doctor


def reset_doctor_password(db: Session, doctor_id: int, password: str) -> User:
    """Admin sets a new password (e.g. the doctor forgot it). The doctor's open sessions end."""
    doctor = get_doctor(db, doctor_id)
    set_password(db, doctor, password, must_change=False)
    return doctor
