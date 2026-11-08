from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, CreatedAtMixin


class AuditLog(CreatedAtMixin, Base):
    """Who read which patient data, and when. Holds ids only — never names or medical data."""

    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True)
    action: Mapped[str] = mapped_column(String(50))
    object_type: Mapped[str] = mapped_column(String(30))
    object_id: Mapped[int | None]
