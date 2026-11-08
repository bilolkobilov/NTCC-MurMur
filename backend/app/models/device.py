from datetime import UTC, datetime, timedelta

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, CreatedAtMixin
from app.models.user import User

# A device is "online" if it sent a heartbeat or polled within this window.
ONLINE_WINDOW = timedelta(seconds=30)


class Device(CreatedAtMixin, Base):
    """A MurMur recorder. Authenticates with an API key; only the key's SHA-256 hash is stored."""

    __tablename__ = "devices"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    serial: Mapped[str] = mapped_column(String(64), unique=True)
    api_key_hash: Mapped[str] = mapped_column(String(64), unique=True)
    doctor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    wifi_rssi: Mapped[int | None]
    firmware_version: Mapped[str | None] = mapped_column(String(32))

    doctor: Mapped[User | None] = relationship()

    @property
    def online(self) -> bool:
        if self.last_seen_at is None:
            return False
        return datetime.now(UTC) - self.last_seen_at <= ONLINE_WINDOW
