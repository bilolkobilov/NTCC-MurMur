"""Patients as seen by their doctor. Every read of patient data is written to the audit log."""

import logging
from datetime import UTC, datetime

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import AIResult, DeviceCommand, Exam, Patient, Recording, Role, Sex, User
from app.security import generate_temp_password
from app.services import audit, storage
from app.services.errors import Conflict, NotFound
from app.services.users import create_user, set_password

log = logging.getLogger(__name__)


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
    audit.record(db, doctor, "patient.create", "patient", patient.id)
    return patient


def _own_patient(db: Session, doctor: User, patient_id: int, *, for_update: bool = False) -> Patient:
    """Another doctor's patient looks exactly like a missing one (404), so ids of others are not revealed.

    `for_update` locks the row until commit, so parallel requests changing the same patient run one after another.
    """
    patient = db.get(Patient, patient_id, with_for_update=for_update, populate_existing=for_update)
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
    """Ownership check for a new exam, holding a share lock on the patient until the exam is committed.

    If the patient is being deleted at the same moment, we wait for the delete and then see 404 — instead of
    inserting an exam for a patient that no longer exists (500). Parallel exam starts do not block each other.
    """
    patient = db.get(Patient, patient_id, with_for_update={"read": True}, populate_existing=True)
    if patient is None or patient.doctor_id != doctor.id:
        raise NotFound("patient not found")
    return patient


def record_consent(db: Session, doctor: User, patient_id: int) -> Patient:
    patient = _own_patient(db, doctor, patient_id)
    if patient.consent_given_at is None:
        patient.consent_given_at = datetime.now(UTC)
    audit.record(db, doctor, "patient.consent", "patient", patient.id)  # commits the consent too
    return patient


def create_patient_login(db: Session, doctor: User, patient_id: int, username: str) -> tuple[User, str]:
    """Returns the new login and its temporary password (shown once; the patient must change it)."""
    patient = _own_patient(db, doctor, patient_id, for_update=True)
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


def reset_patient_password(db: Session, doctor: User, patient_id: int) -> tuple[User, str]:
    """New one-time password for the patient's login (shown once; must be changed). Old sessions end."""
    patient = _own_patient(db, doctor, patient_id)
    if patient.user is None:
        raise Conflict("patient has no login yet")
    temp_password = generate_temp_password()
    set_password(db, patient.user, temp_password, must_change=True)
    return patient.user, temp_password


def update_patient(db: Session, doctor: User, patient_id: int, changes: dict) -> Patient:
    """Apply the given field changes; the patient's login keeps the same display name."""
    patient = _own_patient(db, doctor, patient_id, for_update=True)
    for field, value in changes.items():
        setattr(patient, field, value)
    if "full_name" in changes and patient.user is not None:
        patient.user.full_name = changes["full_name"]
    db.commit()
    audit.record(db, doctor, "patient.update", "patient", patient.id)
    return patient


def delete_patient(db: Session, doctor: User, patient_id: int) -> None:
    """Erase a patient completely (data-deletion request): profile, login, exams, AI results, commands, WAV files.

    Cannot be undone. The audit log keeps only ids. Exam rows are locked first, so an upload that is in progress
    finishes before (and is then deleted too) instead of racing with the delete.
    """
    patient = _own_patient(db, doctor, patient_id, for_update=True)
    exam_ids = list(db.scalars(select(Exam.id).where(Exam.patient_id == patient.id).with_for_update()))
    file_names = list(db.scalars(select(Recording.file_name).where(Recording.exam_id.in_(exam_ids))))

    db.execute(delete(AIResult).where(AIResult.exam_id.in_(exam_ids)))
    db.execute(delete(Recording).where(Recording.exam_id.in_(exam_ids)))
    db.execute(delete(DeviceCommand).where(DeviceCommand.exam_id.in_(exam_ids)))
    db.execute(delete(Exam).where(Exam.id.in_(exam_ids)))
    login_user = patient.user
    db.delete(patient)
    db.flush()  # the patient row points at its login, so it must go first
    if login_user is not None:
        db.delete(login_user)
    audit.record(db, doctor, "patient.delete", "patient", patient_id)  # commits everything above at once

    for file_name in file_names:  # only after the commit: a failed delete must not lose the audio
        try:
            storage.delete_recording(file_name)
        except OSError:
            log.exception("could not delete recording file %s", file_name)
