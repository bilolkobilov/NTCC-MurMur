from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models import AuscultationPoint, Sex


class MyProfile(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    full_name: str
    birth_year: int
    sex: Sex
    height_cm: float | None
    weight_kg: float | None
    doctor_name: str


class MyExam(BaseModel):
    """Deliberately has no AI fields: a patient sees only the doctor's reviewed conclusion."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    point: AuscultationPoint
    created_at: datetime
    reviewed_at: datetime
    doctor_note: str
