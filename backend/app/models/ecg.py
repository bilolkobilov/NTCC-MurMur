from sqlalchemy import JSON, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, CreatedAtMixin


class EcgRecording(CreatedAtMixin, Base):
    """The single-lead ECG the device recorded together with the sound. `file_name` is a random `<uuid>.ecg` next to
    the WAVs: little-endian int32 ADS1292R codes, `channels` interleaved (services/ecg.py)."""

    __tablename__ = "ecg_recordings"

    id: Mapped[int] = mapped_column(primary_key=True)
    exam_id: Mapped[int] = mapped_column(ForeignKey("exams.id"), unique=True)
    file_name: Mapped[str] = mapped_column(String(64), unique=True)
    size_bytes: Mapped[int]
    sample_rate: Mapped[int]
    channels: Mapped[int]
    duration_s: Mapped[float]
    gain: Mapped[int]
    vref_mv: Mapped[float]
    lead_off: Mapped[bool] = mapped_column(default=False)

    exam: Mapped[Exam] = relationship(back_populates="ecg_recording")  # noqa: F821


class EcgResult(CreatedAtMixin, Base):
    """What the server measured in the ECG. Never decides the exam's status: a bad ECG only says "cannot judge".

    `method_version` is the rule set (heart rate, quality); `rhythm_model_*` name the AI that judged the rhythm, empty
    when no model ran (weights missing, or the ECG was too poor to show to it)."""

    __tablename__ = "ecg_results"

    id: Mapped[int] = mapped_column(primary_key=True)
    exam_id: Mapped[int] = mapped_column(ForeignKey("exams.id"), unique=True)
    method_version: Mapped[str] = mapped_column(String(50))
    quality: Mapped[str] = mapped_column(String(20))  # good | bad
    problem: Mapped[str | None] = mapped_column(String(30))  # code from services/ecg.py when quality is bad
    channel: Mapped[int | None]
    heart_rate: Mapped[int | None]
    rr_cv: Mapped[float | None]
    beats: Mapped[int] = mapped_column(default=0)
    snr: Mapped[float | None]
    r_peaks_s: Mapped[list[float]] = mapped_column(JSON, default=list)
    rhythm_label: Mapped[str | None] = mapped_column(String(30))  # af_suspected | no_af | unclear
    rhythm_p_af: Mapped[float | None]
    rhythm_model_name: Mapped[str | None] = mapped_column(String(100))
    rhythm_model_version: Mapped[str | None] = mapped_column(String(50))

    exam: Mapped[Exam] = relationship(back_populates="ecg_result")  # noqa: F821
