from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, CreatedAtMixin


class AIResult(CreatedAtMixin, Base):
    """Analyzer output for an exam. Always records which model and version produced it."""

    __tablename__ = "ai_results"

    id: Mapped[int] = mapped_column(primary_key=True)
    exam_id: Mapped[int] = mapped_column(ForeignKey("exams.id"), unique=True)
    model_name: Mapped[str] = mapped_column(String(100))
    model_version: Mapped[str] = mapped_column(String(50))
    quality: Mapped[str] = mapped_column(String(20))
    label: Mapped[str] = mapped_column(String(50))
    score: Mapped[float | None]

    exam: Mapped[Exam] = relationship(back_populates="ai_result")  # noqa: F821
