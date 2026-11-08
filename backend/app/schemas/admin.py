from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import FullName, NewPassword, Username


class DoctorCreate(BaseModel):
    username: Username
    password: NewPassword
    full_name: FullName


class DoctorOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    full_name: str
    is_active: bool
    created_at: datetime
    patient_count: int = 0


class DeviceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    serial: str = Field(min_length=1, max_length=64)
    doctor_id: int | None = None


class DeviceAssign(BaseModel):
    doctor_id: int | None


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
