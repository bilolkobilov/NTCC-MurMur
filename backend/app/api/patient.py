"""Patient: own profile and own reviewed exams."""

from fastapi import APIRouter

from app.deps import CurrentPatient, DbSession
from app.schemas.patient import MyExam, MyProfile
from app.services import patient_portal

router = APIRouter(prefix="/api/me", tags=["patient"])


@router.get("")
def my_profile(db: DbSession, user: CurrentPatient) -> MyProfile:
    patient = patient_portal.read_profile(db, user)
    return MyProfile(
        full_name=patient.full_name,
        birth_year=patient.birth_year,
        sex=patient.sex,
        height_cm=patient.height_cm,
        weight_kg=patient.weight_kg,
        doctor_name=patient.doctor.full_name,
    )


@router.get("/exams")
def my_exams(db: DbSession, user: CurrentPatient) -> list[MyExam]:
    return [MyExam.model_validate(exam) for exam in patient_portal.list_reviewed_exams(db, user)]
