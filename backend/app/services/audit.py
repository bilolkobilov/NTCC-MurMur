"""Audit log: one row each time a doctor or patient reads patient data. Ids only, never names or results."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AuditLog, User


def record(db: Session, user: User, action: str, object_type: str, object_id: int | None) -> None:
    """Add an audit row and commit it, so the read is logged even if the response later fails."""
    db.add(AuditLog(user_id=user.id, action=action, object_type=object_type, object_id=object_id))
    db.commit()


def list_entries(
    db: Session, *, limit: int, offset: int, action: str | None = None
) -> list[tuple[AuditLog, User | None]]:
    """Newest first. `action` filters by prefix: "exam" → exam.read, exam.review, …; "exam.read" → only that."""
    query = select(AuditLog, User).outerjoin(User, User.id == AuditLog.user_id)
    if action:
        query = query.where((AuditLog.action == action) | AuditLog.action.startswith(action + ".", autoescape=True))
    rows = db.execute(query.order_by(AuditLog.id.desc()).limit(limit).offset(offset))
    return [(entry, user) for entry, user in rows]
