"""Patient: own profile (contact details editable) and own reviewed exams."""

from fastapi import APIRouter

from app.deps import CurrentPatient, DbSession
from app.schemas.patient import LatestAnalysis, MyContactUpdate, MyExam, MyProfile
from app.services import patient_portal

router = APIRouter(prefix="/api/me", tags=["patient"])


def _profile(data: patient_portal.MyProfileData) -> MyProfile:
    patient = data.patient
    return MyProfile(
        patient_id=patient.id,
        full_name=patient.full_name,
        birth_year=patient.birth_year,
        sex=patient.sex,
        height_cm=patient.height_cm,
        weight_kg=patient.weight_kg,
        doctor_name=patient.doctor.full_name,
        doctor_clinic=patient.doctor.clinic,
        clinic=patient.clinic,
        registered_at=patient.created_at,
        password_changed_at=data.password_changed_at,
        latest_analysis=LatestAnalysis(**data.latest_analysis) if data.latest_analysis else None,
        heart_rate=data.heart_rate,
        heart_rate_at=data.heart_rate_at,
        phone=patient.phone,
        email=patient.email,
        city=patient.city,
        emergency_contact_name=patient.emergency_contact_name,
        emergency_contact_phone=patient.emergency_contact_phone,
    )


@router.get("")
def my_profile(db: DbSession, user: CurrentPatient) -> MyProfile:
    return _profile(patient_portal.read_profile(db, user))


@router.patch("")
def update_my_contact(body: MyContactUpdate, db: DbSession, user: CurrentPatient) -> MyProfile:
    """Only the fields sent change; an empty value clears the field."""
    patient_portal.update_contact(db, user, body.model_dump(exclude_unset=True))
    return _profile(patient_portal.read_profile(db, user))


@router.get("/exams")
def my_exams(db: DbSession, user: CurrentPatient) -> list[MyExam]:
    return [MyExam.model_validate(row) for row in patient_portal.list_reviewed_exams(db, user)]
