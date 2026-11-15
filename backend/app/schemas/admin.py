from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, computed_field, field_validator, model_validator

from app.models import Sex
from app.schemas.common import FullName, NewPassword, RefId, Username

# The clinic is free text; blank means "not set".
Clinic = Annotated[str | None, StringConstraints(strip_whitespace=True, max_length=200)]


class DoctorCreate(BaseModel):
    username: Username
    password: NewPassword
    full_name: FullName
    clinic: Clinic = None

    @field_validator("clinic")
    @classmethod
    def blank_is_none(cls, value):
        return value or None


class DoctorUpdate(BaseModel):
    """Only the fields that are sent change. A blank clinic clears it."""

    full_name: FullName | None = None
    clinic: Clinic = None

    @field_validator("clinic")
    @classmethod
    def blank_is_none(cls, value):
        return value or None

    @model_validator(mode="after")
    def something_to_change(self):
        if not self.model_fields_set:
            raise ValueError("nothing to change")
        if "full_name" in self.model_fields_set and self.full_name is None:
            raise ValueError("full_name cannot be empty")
        return self


class DoctorOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    full_name: str
    clinic: str | None
    is_active: bool
    created_at: datetime
    last_login_at: datetime | None = None
    patient_count: int = 0

    @computed_field
    @property
    def status(self) -> Literal["active", "invited", "suspended"]:
        """Suspended = blocked by the admin; invited = the account never signed in yet."""
        if not self.is_active:
            return "suspended"
        return "invited" if self.last_login_at is None else "active"


class DoctorWorkload(BaseModel):
    """Counts about the doctor's work. Numbers only."""

    patients: int
    seen_today: int
    recordings_30d: int
    devices_30d: int
    needs_review: int
    median_review_minutes: int | None


class DoctorDeviceRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    serial: str
    online: bool
    last_seen_at: datetime | None


class DoctorProfileOut(DoctorOut):
    password_changed_at: datetime | None
    workload: DoctorWorkload
    devices: list[DoctorDeviceRow]

    @classmethod
    def build(cls, data: dict) -> DoctorProfileOut:
        """From `services.doctors.profile()`."""
        doctor = data["doctor"]
        return cls(
            **DoctorOut.model_validate(doctor).model_dump(exclude={"status", "patient_count"}),
            patient_count=data["patient_count"],
            password_changed_at=doctor.password_changed_at,
            workload=data["workload"],
            devices=data["devices"],
        )


class DoctorPatientRow(BaseModel):
    """One patient of a doctor, as the admin sees them: who and when — no recordings, AI results or notes."""

    id: int
    full_name: str
    birth_year: int
    sex: Sex
    last_exam_at: datetime | None


class ActivityEntryOut(BaseModel):
    id: int
    action: str
    object_type: str
    created_at: datetime


DisconnectReason = Literal["maintenance", "lost", "security", "retired"]


class DeviceCreate(BaseModel):
    """`name` is optional: without it the device is called by its code (MM-0007)."""

    name: str | None = Field(default=None, max_length=100)
    serial: str = Field(min_length=1, max_length=64)
    model: Literal["MurMur S2", "MurMur S3"] = "MurMur S2"
    location: str | None = Field(default=None, max_length=100)
    doctor_id: RefId | None = None


class DeviceAssign(BaseModel):
    doctor_id: RefId | None


class DeviceDisconnect(BaseModel):
    reason: DisconnectReason


class DeviceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str
    serial: str
    model: str
    location: str | None
    doctor_id: int | None
    doctor_name: str | None
    clinic: str | None
    online: bool
    last_seen_at: datetime | None
    wifi_rssi: int | None
    firmware_version: str | None
    battery_pct: int | None
    mic_noise_db: int | None
    wifi_ssid: str | None
    ip: str | None
    mac: str | None
    gateway: str | None
    disconnected_at: datetime | None
    disconnect_reason: str | None
    last_self_test_at: datetime | None
    last_self_test_ok: bool | None
    created_at: datetime
    # Derived (services/device_health.py); `build` fills them.
    state: Literal["pending", "online", "offline", "disconnected"] = "pending"
    health: Literal["pending", "healthy", "attention", "degraded", "fault"] = "pending"
    checks: dict[str, str] = {}
    busy: bool = Field(default=False, description="An exam is being recorded on it right now")
    latest_firmware: str | None = None

    @classmethod
    def build(cls, device, *, busy: bool = False) -> DeviceOut:
        from app.services import device_health

        out = cls.model_validate(device)
        out.state = device_health.state(device)
        out.health = device_health.health(device)
        out.checks = device_health.checks(device)
        out.busy = busy
        out.latest_firmware = device_health.latest_firmware()
        return out


class DeviceCreated(DeviceOut):
    api_key: str = Field(description="Shown only once. Put it into the device firmware.")


class StatsOut(BaseModel):
    doctors_total: int
    doctors_active: int
    patients_total: int
    devices_total: int
    devices_online: int
    exams_today: int
    exams_by_status: dict[str, int]
    analyzer: dict[str, str] = Field(description="AI model currently used for new exams: name and version")


class AuditEntryOut(BaseModel):
    id: int
    user_id: int | None
    username: str | None
    role: str | None
    action: str
    object_type: str
    object_id: int | None
    created_at: datetime


class DoctorPasswordReset(BaseModel):
    password: NewPassword
