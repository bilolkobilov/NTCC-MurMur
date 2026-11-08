from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, CreatedAtMixin
from app.models.enums import Sex, str_enum
from app.models.user import User


class Patient(CreatedAtMixin, Base):
    """A person being screened. Belongs to one doctor; may have a patient login (`user_id`)."""

    __tablename__ = "patients"

    id: Mapped[int] = mapped_column(primary_key=True)
    doctor_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), unique=True)
    full_name: Mapped[str] = mapped_column(String(200))
    birth_year: Mapped[int]
    sex: Mapped[Sex] = mapped_column(str_enum(Sex, "sex"))
    height_cm: Mapped[float | None]
    weight_kg: Mapped[float | None]
    consent_given_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    doctor: Mapped[User] = relationship(foreign_keys=[doctor_id])
    user: Mapped[User | None] = relationship(foreign_keys=[user_id])

    @property
    def has_login(self) -> bool:
        return self.user_id is not None
