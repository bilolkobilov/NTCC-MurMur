"""Audit log: who read or changed patient data, and when. Ids only, never names or results.

Changes (create, review, delete, …) are logged every time. Reads are logged once per user, action and record per
READ_REPEAT_WINDOW: a page that stays open re-reads by itself (the live exam every second), and one row per poll
buried the real reads (owner decision 2026-11-08).
"""

from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import AuditLog, User


def record(db: Session, user: User, action: str, object_type: str, object_id: int | None) -> None:
    """Add an audit row and commit it, so the read is logged even if the response later fails."""
    db.add(AuditLog(user_id=user.id, action=action, object_type=object_type, object_id=object_id))
    db.commit()


READ_REPEAT_WINDOW = timedelta(minutes=5)


def record_read(db: Session, user: User, action: str, object_type: str, object_id: int | None) -> None:
    """Log a read, unless the same user read the same record with the same action within READ_REPEAT_WINDOW."""
    same_object = AuditLog.object_id.is_(None) if object_id is None else AuditLog.object_id == object_id
    recent = db.scalar(
        select(AuditLog.id)
        .where(
            AuditLog.user_id == user.id,
            AuditLog.action == action,
            AuditLog.object_type == object_type,
            same_object,
            AuditLog.created_at >= func.now() - READ_REPEAT_WINDOW,
        )
        .limit(1)
    )
    if recent is None:
        record(db, user, action, object_type, object_id)


def list_entries(
    db: Session, *, limit: int, offset: int, action: str | None = None
) -> list[tuple[AuditLog, User | None]]:
    """Newest first. `action` filters by prefix: "exam" → exam.read, exam.review, …; "exam.read" → only that."""
    query = select(AuditLog, User).outerjoin(User, User.id == AuditLog.user_id)
    if action:
        query = query.where((AuditLog.action == action) | AuditLog.action.startswith(action + ".", autoescape=True))
    rows = db.execute(query.order_by(AuditLog.id.desc()).limit(limit).offset(offset))
    return [(entry, user) for entry, user in rows]
