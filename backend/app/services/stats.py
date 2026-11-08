"""System numbers for the admin. Counts only — no patient data."""

from datetime import UTC, datetime, time
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Device, Exam, ExamStatus, Patient, Role, User
from app.services.devices import ONLINE_WINDOW


def system_stats(db: Session) -> dict:
    now = datetime.now(UTC)
    local_zone = ZoneInfo(get_settings().app_timezone)
    start_of_day = datetime.combine(now.astimezone(local_zone).date(), time.min, tzinfo=local_zone)

    def count(statement) -> int:
        return db.scalar(statement) or 0

    by_status = dict(db.execute(select(Exam.status, func.count()).group_by(Exam.status)).all())
    return {
        "doctors_total": count(select(func.count()).select_from(User).where(User.role == Role.DOCTOR)),
        "doctors_active": count(
            select(func.count()).select_from(User).where(User.role == Role.DOCTOR, User.is_active)
        ),
        "patients_total": count(select(func.count()).select_from(Patient)),
        "devices_total": count(select(func.count()).select_from(Device)),
        "devices_online": count(
            select(func.count()).select_from(Device).where(Device.last_seen_at >= now - ONLINE_WINDOW)
        ),
        "exams_today": count(select(func.count()).select_from(Exam).where(Exam.created_at >= start_of_day)),
        "exams_by_status": {status.value: by_status.get(status, 0) for status in ExamStatus},
    }
