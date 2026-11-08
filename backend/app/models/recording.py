from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, CreatedAtMixin


class Recording(CreatedAtMixin, Base):
    """The uploaded WAV of an exam. `file_name` is a random `<uuid>.wav` inside the recordings folder."""

    __tablename__ = "recordings"

    id: Mapped[int] = mapped_column(primary_key=True)
    exam_id: Mapped[int] = mapped_column(ForeignKey("exams.id"), unique=True)
    file_name: Mapped[str] = mapped_column(String(64), unique=True)
    size_bytes: Mapped[int]
    sample_rate: Mapped[int]
    duration_s: Mapped[float]
    motion_detected: Mapped[bool] = mapped_column(default=False)

    exam: Mapped["Exam"] = relationship(back_populates="recording")  # noqa: F821
