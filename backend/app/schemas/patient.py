from datetime import datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, StringConstraints

from app.models import AuscultationPoint, Sex


def _blank_is_none(value: str | None) -> str | None:
    return value or None


# Optional text the patient types; an empty box clears the value.
_Text = Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]
_City = Annotated[str, StringConstraints(strip_whitespace=True, max_length=100)]  # patients.city is String(100)
_Phone = Annotated[str, StringConstraints(strip_whitespace=True, max_length=32, pattern=r"^([0-9+()\- ]{5,32})?$")]
_EMAIL = r"^([^@\s]+@[^@\s]+\.[^@\s]+)?$"
_Email = Annotated[str, StringConstraints(strip_whitespace=True, max_length=200, pattern=_EMAIL)]


class LatestAnalysis(BaseModel):
    clinic: str | None
    device_code: str | None
    at: datetime


class MyProfile(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    patient_id: int
    full_name: str
    birth_year: int
    sex: Sex
    height_cm: float | None
    weight_kg: float | None
    doctor_name: str
    doctor_clinic: str | None
    clinic: str | None  # where the patient was registered
    registered_at: datetime
    password_changed_at: datetime | None
    latest_analysis: LatestAnalysis | None
    heart_rate: int | None  # newest value the doctor entered (bpm)
    heart_rate_at: datetime | None
    phone: str | None
    email: str | None
    city: str | None
    emergency_contact_name: str | None
    emergency_contact_phone: str | None


class MyContactUpdate(BaseModel):
    """What a patient may change about themselves. Name, birth year and the rest are managed by the clinic."""

    model_config = ConfigDict(extra="forbid")

    phone: Annotated[_Phone | None, AfterValidator(_blank_is_none)] = None
    email: Annotated[_Email | None, AfterValidator(_blank_is_none)] = None
    city: Annotated[_City | None, AfterValidator(_blank_is_none)] = None
    emergency_contact_name: Annotated[_Text | None, AfterValidator(_blank_is_none)] = None
    emergency_contact_phone: Annotated[_Phone | None, AfterValidator(_blank_is_none)] = None


class MyExam(BaseModel):
    """A reviewed exam. The patient gets the doctor's conclusion and the AI's yes/no label, never the score, the
    model or whether the doctor agreed with it."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    point: AuscultationPoint
    created_at: datetime
    reviewed_at: datetime
    doctor_note: str
    doctor_name: str
    clinic: str | None  # where it was analyzed: the clinic of the device's doctor
    device_code: str | None
    ai_label: Literal["murmur", "absent"] | None  # None: the AI gave no answer for this recording
    recording_quality: Literal["good", "bad", "unknown"] | None
