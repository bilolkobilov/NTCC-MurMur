from datetime import UTC, datetime, timedelta

from sqlalchemy import Boolean, DateTime, ForeignKey, String
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

    model: Mapped[str] = mapped_column(String(32), default="MurMur S2", server_default="MurMur S2")
    location: Mapped[str | None] = mapped_column(String(100))
    # What the firmware reports with each heartbeat (all optional; a device that does not know a value omits it).
    battery_pct: Mapped[int | None]
    mic_noise_db: Mapped[int | None]
    wifi_ssid: Mapped[str | None] = mapped_column(String(32))
    ip: Mapped[str | None] = mapped_column(String(45))
    mac: Mapped[str | None] = mapped_column(String(17))
    gateway: Mapped[str | None] = mapped_column(String(45))
    # Set by the admin: the device is blocked from the API until it is reconnected (reason is an enum value).
    disconnected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    disconnect_reason: Mapped[str | None] = mapped_column(String(20))
    last_self_test_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_self_test_ok: Mapped[bool | None] = mapped_column(Boolean)

    doctor: Mapped[User | None] = relationship()

    @property
    def code(self) -> str:
        """The short id people say aloud and the doctor picks by: MM-0007."""
        return f"MM-{self.id:04d}"

    @property
    def doctor_name(self) -> str | None:
        return self.doctor.full_name if self.doctor else None

    @property
    def clinic(self) -> str | None:
        """The clinic of the assigned doctor (a clinic is free text on the doctor, not a table)."""
        return self.doctor.clinic if self.doctor else None

    @property
    def online(self) -> bool:
        if self.last_seen_at is None:
            return False
        return datetime.now(UTC) - self.last_seen_at <= ONLINE_WINDOW
