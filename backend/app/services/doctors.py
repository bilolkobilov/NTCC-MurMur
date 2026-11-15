"""Doctor accounts, managed by the admin."""

from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import extract, func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import AuditLog, Device, Exam, ExamStatus, Patient, Role, User
from app.services import audit
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


def update_doctor(db: Session, doctor_id: int, changes: dict) -> User:
    """Change the name and/or clinic (only keys present in `changes`)."""
    doctor = get_doctor(db, doctor_id)
    for key in ("full_name", "clinic"):
        if key in changes:
            setattr(doctor, key, changes[key])
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


def workload(db: Session, doctor: User) -> dict:
    """Numbers about one doctor's work: patients, today, last 30 days, what waits for review."""
    now = datetime.now(UTC)
    zone = ZoneInfo(get_settings().app_timezone)
    start_of_day = datetime.combine(now.astimezone(zone).date(), time.min, tzinfo=zone)
    since = now - timedelta(days=30)
    recorded = (ExamStatus.UPLOADED, ExamStatus.ANALYZED, ExamStatus.REVIEWED)

    def count(statement) -> int:
        return db.scalar(statement) or 0

    review_seconds = db.scalar(
        select(func.percentile_cont(0.5).within_group(extract("epoch", Exam.reviewed_at - Exam.created_at))).where(
            Exam.doctor_id == doctor.id, Exam.status == ExamStatus.REVIEWED, Exam.reviewed_at >= since
        )
    )
    return {
        "patients": count(select(func.count()).select_from(Patient).where(Patient.doctor_id == doctor.id)),
        "seen_today": count(
            select(func.count(Exam.patient_id.distinct())).where(
                Exam.doctor_id == doctor.id, Exam.created_at >= start_of_day
            )
        ),
        "recordings_30d": count(
            select(func.count())
            .select_from(Exam)
            .where(Exam.doctor_id == doctor.id, Exam.status.in_(recorded), Exam.created_at >= since)
        ),
        "devices_30d": count(
            select(func.count(Exam.device_id.distinct())).where(
                Exam.doctor_id == doctor.id, Exam.status.in_(recorded), Exam.created_at >= since
            )
        ),
        "needs_review": count(
            select(func.count())
            .select_from(Exam)
            .where(Exam.doctor_id == doctor.id, Exam.status == ExamStatus.ANALYZED)
        ),
        "median_review_minutes": None if review_seconds is None else round(float(review_seconds) / 60),
    }


def profile(db: Session, doctor: User) -> dict:
    """Everything the profile page shows about a doctor (the same for the doctor and the admin)."""
    devices = list(
        db.scalars(
            select(Device)
            .where(Device.doctor_id == doctor.id)
            .order_by(Device.last_seen_at.desc().nulls_last(), Device.id)
        )
    )
    patients = db.scalar(select(func.count()).select_from(Patient).where(Patient.doctor_id == doctor.id)) or 0
    return {"doctor": doctor, "patient_count": patients, "workload": workload(db, doctor), "devices": devices}


def patients_of(db: Session, admin: User, doctor_id: int, *, limit: int, offset: int) -> list[dict]:
    """The doctor's patients for the admin: name, age, sex and when the last exam was. Logged as a read."""
    get_doctor(db, doctor_id)
    last_exam = func.max(Exam.created_at)
    rows = db.execute(
        select(Patient, last_exam)
        .outerjoin(Exam, Exam.patient_id == Patient.id)
        .where(Patient.doctor_id == doctor_id)
        .group_by(Patient.id)
        .order_by(last_exam.desc().nulls_last(), Patient.full_name, Patient.id)
        .limit(limit)
        .offset(offset)
    )
    audit.record_read(db, admin, "doctor.patients", "doctor", doctor_id)
    return [
        {
            "id": patient.id,
            "full_name": patient.full_name,
            "birth_year": patient.birth_year,
            "sex": patient.sex.value,
            "last_exam_at": at,
        }
        for patient, at in rows
    ]


def activity(db: Session, doctor_id: int, *, limit: int) -> list[AuditLog]:
    """What the doctor did, newest first. The audit log holds ids only, so no patient names leak."""
    return list(
        db.scalars(select(AuditLog).where(AuditLog.user_id == doctor_id).order_by(AuditLog.id.desc()).limit(limit))
    )
