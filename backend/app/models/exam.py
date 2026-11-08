from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, CreatedAtMixin
from app.models.enums import AuscultationPoint, ExamStatus, str_enum
from app.models.patient import Patient


class Exam(CreatedAtMixin, Base):
    """One recording session at one chest point. Status changes only through `services/exam_flow.py`."""

    __tablename__ = "exams"

    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), index=True)
    doctor_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    device_id: Mapped[int] = mapped_column(ForeignKey("devices.id"), index=True)
    point: Mapped[AuscultationPoint] = mapped_column(str_enum(AuscultationPoint, "point"))
    status: Mapped[ExamStatus] = mapped_column(str_enum(ExamStatus, "exam_status"), default=ExamStatus.WAITING)
    failure_reason: Mapped[str | None] = mapped_column(String(500))
    doctor_note: Mapped[str | None] = mapped_column(Text)
    doctor_agrees_with_ai: Mapped[bool | None]
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    patient: Mapped[Patient] = relationship()
    recording: Mapped["Recording | None"] = relationship(back_populates="exam")  # noqa: F821
    ai_result: Mapped["AIResult | None"] = relationship(back_populates="exam")  # noqa: F821
