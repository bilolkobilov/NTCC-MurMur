"""Patients as seen by their doctor. Every read of patient data is written to the audit log."""

import logging
from dataclasses import dataclass
from datetime import UTC, datetime, time
from zoneinfo import ZoneInfo

from sqlalchemy import and_, delete, func, select
from sqlalchemy.dialects.postgresql import distinct_on
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import (
    AIResult,
    Device,
    DeviceCommand,
    EcgRecording,
    EcgResult,
    Exam,
    Patient,
    Recording,
    Role,
    Sex,
    User,
    VitalSigns,
)
from app.security import generate_temp_password
from app.services import audit, storage
from app.services.errors import Conflict, NotFound
from app.services.result_status import RegistryStatus, derive, priority_rank
from app.services.users import create_user, set_password

log = logging.getLogger(__name__)


def create_patient(
    db: Session,
    doctor: User,
    *,
    full_name: str,
    birth_year: int,
    sex: Sex,
    height_cm: float,
    weight_kg: float,
    consent_given: bool,
) -> Patient:
    patient = Patient(
        doctor_id=doctor.id,
        full_name=full_name,
        birth_year=birth_year,
        sex=sex,
        height_cm=height_cm,
        weight_kg=weight_kg,
        clinic=doctor.clinic,
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


@dataclass(frozen=True)
class RegistryRow:
    patient: Patient
    last_exam: Exam | None
    device_name: str | None
    device_clinic: str | None
    status: RegistryStatus


def _registry(db: Session, doctor: User, search: str | None = None) -> list[RegistryRow]:
    """Every own patient with the latest exam and the status derived from it (one query, no N+1).

    A doctor's roster is small, so filtering, sorting and paging happen in Python after the status is derived.
    """
    latest = (
        select(Exam.id)
        .where(Exam.doctor_id == doctor.id)
        .ext(distinct_on(Exam.patient_id))
        .order_by(Exam.patient_id, Exam.created_at.desc(), Exam.id.desc())
        .scalar_subquery()
    )
    query = (
        select(Patient, Exam, AIResult, Device)
        .outerjoin(Exam, and_(Exam.patient_id == Patient.id, Exam.id.in_(latest)))
        .outerjoin(AIResult, AIResult.exam_id == Exam.id)
        .outerjoin(Device, Device.id == Exam.device_id)
        .where(Patient.doctor_id == doctor.id)
    )
    if search:
        escaped = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")  # % and _ match literally
        query = query.where(Patient.full_name.ilike(f"%{escaped}%", escape="\\"))
    rows = []
    for patient, exam, ai, device in db.execute(query):
        status = derive(
            exam.status if exam else None,
            ai_quality=ai.quality if ai else None,
            ai_label=ai.label if ai else None,
            doctor_agrees=exam.doctor_agrees_with_ai if exam else None,
        )
        rows.append(RegistryRow(patient, exam, device.name if device else None, exam.clinic if exam else None, status))
    return rows


def list_patients(
    db: Session, doctor: User, *, search: str | None, sort: str, status: str, limit: int, offset: int
) -> list[RegistryRow]:
    """Own patients for the registry. `search` matches any part of the name, case-insensitive.

    sort: "recent" (latest exam first, no exam last), "name", "priority" (what needs the doctor first).
    status: "all", "needs_review" or "pending".
    """
    rows = _registry(db, doctor, search)
    if status == "needs_review":
        rows = [r for r in rows if r.status.needs_review]
    elif status == "pending":
        rows = [r for r in rows if r.status.result_status == "pending"]
    rows.sort(key=lambda r: (r.patient.full_name.lower(), r.patient.id))  # the tie-break for every sort
    if sort == "recent":
        rows.sort(key=lambda r: r.last_exam.created_at.timestamp() if r.last_exam else float("-inf"), reverse=True)
    elif sort == "priority":
        rows.sort(
            key=lambda r: (
                priority_rank(r.status),
                -(r.last_exam.created_at.timestamp() if r.last_exam else float("-inf")),
            )
        )
    audit.record_read(db, doctor, "patient.list", "patient", None)
    return rows[offset : offset + limit]


def summary(db: Session, doctor: User) -> dict[str, int]:
    """Counts over the whole roster (the list is paged, so they cannot come from its rows)."""
    rows = _registry(db, doctor)
    local_zone = ZoneInfo(get_settings().app_timezone)
    start_of_day = datetime.combine(datetime.now(UTC).astimezone(local_zone).date(), time.min, tzinfo=local_zone)
    assigned_today = db.scalar(
        select(func.count(Exam.patient_id.distinct())).where(
            Exam.doctor_id == doctor.id, Exam.created_at >= start_of_day
        )
    )
    audit.record_read(db, doctor, "patient.summary", "patient", None)
    return {
        "total": len(rows),
        "assigned_today": assigned_today or 0,
        "normal": sum(r.status.result_status == "normal" for r in rows),
        "needs_review": sum(r.status.needs_review for r in rows),
        "pending": sum(r.status.result_status == "pending" for r in rows),
    }


def read_patient(db: Session, doctor: User, patient_id: int) -> Patient:
    patient = _own_patient(db, doctor, patient_id)
    audit.record_read(db, doctor, "patient.read", "patient", patient.id)
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


@dataclass(frozen=True)
class ExamRow:
    exam: Exam
    duration_s: float | None
    device: Device | None
    ai_label: str | None
    status: RegistryStatus


def list_patient_exams(db: Session, doctor: User, patient_id: int) -> list[ExamRow]:
    """The patient's exams, newest first, with length, device (and its clinic) and the derived result status."""
    patient = _own_patient(db, doctor, patient_id)
    query = (
        select(Exam, Recording.duration_s, Device, AIResult)
        .outerjoin(Recording, Recording.exam_id == Exam.id)
        .outerjoin(Device, Device.id == Exam.device_id)
        .outerjoin(AIResult, AIResult.exam_id == Exam.id)
        .where(Exam.patient_id == patient.id)
        .order_by(Exam.id.desc())
    )
    rows = [
        ExamRow(
            exam,
            duration,
            device,
            ai.label if ai else None,
            derive(
                exam.status,
                ai_quality=ai.quality if ai else None,
                ai_label=ai.label if ai else None,
                doctor_agrees=exam.doctor_agrees_with_ai,
            ),
        )
        for exam, duration, device, ai in db.execute(query)
    ]
    audit.record_read(db, doctor, "patient.exams.list", "patient", patient.id)
    return rows


def record_vitals(db: Session, doctor: User, patient_id: int, values: dict) -> tuple[VitalSigns, str]:
    """Save a new set of vital signs. Returns it with the name of whoever entered it."""
    patient = _own_patient(db, doctor, patient_id)
    vitals = VitalSigns(patient_id=patient.id, doctor_id=doctor.id, **values)
    db.add(vitals)
    db.commit()
    audit.record(db, doctor, "patient.vitals.create", "patient", patient.id)
    return vitals, doctor.full_name


def latest_vitals(db: Session, doctor: User, patient_id: int) -> tuple[VitalSigns, str] | None:
    """The newest set of vital signs (and who entered it), or None when none was entered."""
    patient = _own_patient(db, doctor, patient_id)
    row = db.execute(
        select(VitalSigns, User.full_name)
        .join(User, User.id == VitalSigns.doctor_id)
        .where(VitalSigns.patient_id == patient.id)
        .order_by(VitalSigns.id.desc())
        .limit(1)
    ).first()
    audit.record_read(db, doctor, "patient.vitals.read", "patient", patient.id)
    return (row[0], row[1]) if row else None


def reset_patient_password(db: Session, doctor: User, patient_id: int) -> tuple[User, str]:
    """New one-time password for the patient's login (shown once; must be changed). Old sessions end.

    The patient row is locked, so parallel resets run one after another: the response that arrives last holds
    the password that works. The web page must still disable the button while a reset is running.
    """
    patient = _own_patient(db, doctor, patient_id, for_update=True)
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
    file_names += list(db.scalars(select(EcgRecording.file_name).where(EcgRecording.exam_id.in_(exam_ids))))

    db.execute(delete(VitalSigns).where(VitalSigns.patient_id == patient.id))
    db.execute(delete(AIResult).where(AIResult.exam_id.in_(exam_ids)))
    db.execute(delete(Recording).where(Recording.exam_id.in_(exam_ids)))
    db.execute(delete(EcgResult).where(EcgResult.exam_id.in_(exam_ids)))
    db.execute(delete(EcgRecording).where(EcgRecording.exam_id.in_(exam_ids)))
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
