from sqlalchemy import ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, CreatedAtMixin


class VitalSigns(CreatedAtMixin, Base):
    """Vital signs a doctor typed in for a patient (migration 0008). Every value is optional."""

    __tablename__ = "vital_signs"

    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), index=True)
    doctor_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    heart_rate: Mapped[int | None]
    systolic: Mapped[int | None]
    diastolic: Mapped[int | None]
    spo2: Mapped[int | None]
    resp_rate: Mapped[int | None]
    temp_c: Mapped[float | None]
