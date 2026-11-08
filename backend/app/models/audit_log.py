from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, CreatedAtMixin


class AuditLog(CreatedAtMixin, Base):
    """Who read which patient data, and when. Holds ids only — never names or medical data.

    `user_id` is deliberately NOT a foreign key: the history must outlive deleted accounts (a deleted patient's
    reads stay in the log as a bare id).
    """

    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(index=True)
    action: Mapped[str] = mapped_column(String(50))
    object_type: Mapped[str] = mapped_column(String(30))
    object_id: Mapped[int | None]
