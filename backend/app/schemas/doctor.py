from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models import AuscultationPoint, ExamStatus, Sex
from app.schemas.common import FullName, RefId, Username


class PatientCreate(BaseModel):
    full_name: FullName
    birth_year: int = Field(ge=1900, le=2100)
    sex: Sex
    height_cm: float | None = Field(default=None, gt=0, lt=300)
    weight_kg: float | None = Field(default=None, gt=0, lt=500)
    consent_given: bool = False


class PatientUpdate(BaseModel):
    """Fix typos in a patient's data. Send only the fields to change; height/weight may be set to null."""

    full_name: FullName | None = None
    birth_year: int | None = Field(default=None, ge=1900, le=2100)
    sex: Sex | None = None
    height_cm: float | None = Field(default=None, gt=0, lt=300)
    weight_kg: float | None = Field(default=None, gt=0, lt=500)

    @model_validator(mode="after")
    def required_fields_not_cleared(self):
        for name in ("full_name", "birth_year", "sex"):
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} cannot be empty")
        return self


class PatientOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    full_name: str
    birth_year: int
    sex: Sex
    height_cm: float | None
    weight_kg: float | None
    consent_given_at: datetime | None
    has_login: bool
    created_at: datetime


class PatientLoginCreate(BaseModel):
    username: Username


class PatientLoginCreated(BaseModel):
    username: str
    temporary_password: str = Field(description="Shown only once. The patient must change it on first login.")


class ExamCreate(BaseModel):
    patient_id: RefId
    device_id: RefId
    point: AuscultationPoint


class ExamReview(BaseModel):
    note: str = Field(min_length=1, max_length=5000)
    agrees_with_ai: bool


class RecordingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    sample_rate: int
    duration_s: float
    motion_detected: bool
    size_bytes: int
    created_at: datetime


class AIResultOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    model_name: str
    model_version: str
    quality: str
    label: str
    score: float | None
    created_at: datetime


class ExamSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    patient_id: int
    device_id: int
    point: AuscultationPoint
    status: ExamStatus
    created_at: datetime
    reviewed_at: datetime | None


class DoctorExamListItem(ExamSummary):
    patient_full_name: str


class ExamDetail(ExamSummary):
    failure_reason: str | None
    doctor_note: str | None
    doctor_agrees_with_ai: bool | None
    updated_at: datetime
    recording: RecordingOut | None
    ai_result: AIResultOut | None


class DoctorDeviceOut(BaseModel):
    """A device the doctor can start exams on."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    serial: str
    online: bool
    last_seen_at: datetime | None
