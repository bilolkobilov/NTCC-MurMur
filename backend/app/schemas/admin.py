from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

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


class DoctorClinic(BaseModel):
    clinic: Clinic

    @field_validator("clinic")
    @classmethod
    def blank_is_none(cls, value):
        return value or None


class DoctorOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    full_name: str
    clinic: str | None
    is_active: bool
    created_at: datetime
    patient_count: int = 0


class DeviceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    serial: str = Field(min_length=1, max_length=64)
    doctor_id: RefId | None = None


class DeviceAssign(BaseModel):
    doctor_id: RefId | None


class DeviceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    serial: str
    doctor_id: int | None
    online: bool
    last_seen_at: datetime | None
    wifi_rssi: int | None
    firmware_version: str | None
    created_at: datetime


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
