from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, CreatedAtMixin
from app.models.enums import CommandStatus, str_enum


class DeviceCommand(CreatedAtMixin, Base):
    """An instruction waiting for a device: "record 20 s for exam X" or "self_test".

    The device picks it up by polling.
    """

    __tablename__ = "device_commands"

    id: Mapped[int] = mapped_column(primary_key=True)
    device_id: Mapped[int] = mapped_column(ForeignKey("devices.id"), index=True)
    exam_id: Mapped[int | None] = mapped_column(ForeignKey("exams.id"), index=True)  # none for self_test
    command: Mapped[str] = mapped_column(String(20), default="record")
    duration_s: Mapped[int] = mapped_column(default=20)
    status: Mapped[CommandStatus] = mapped_column(
        str_enum(CommandStatus, "command_status"), default=CommandStatus.PENDING
    )
    taken_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
