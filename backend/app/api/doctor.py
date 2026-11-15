"""Doctor: own patients, patient logins, exams and reviews."""

from typing import Annotated, Literal

from fastapi import APIRouter, Query, status
from fastapi.responses import FileResponse

from app.deps import CurrentDoctor, DbSession
from app.models import Patient
from app.schemas.admin import ActivityEntryOut, DoctorProfileOut
from app.schemas.common import PathId
from app.schemas.doctor import (
    DoctorDeviceOut,
    ExamCreate,
    ExamDetail,
    ExamReview,
    ExamSummary,
    LastExamOut,
    PatientCreate,
    PatientExamRow,
    PatientLoginCreate,
    PatientLoginCreated,
    PatientOut,
    PatientRegistryRow,
    PatientSummary,
    PatientUpdate,
    VitalsCreate,
    VitalsOut,
)
from app.services import devices, doctors, exams, patients

router = APIRouter(prefix="/api", tags=["doctor"])


def _patient_out(patient: Patient) -> PatientOut:
    return PatientOut.model_validate(patient)


# --- patients ---


@router.post("/patients", status_code=status.HTTP_201_CREATED)
def create_patient(body: PatientCreate, db: DbSession, doctor: CurrentDoctor) -> PatientOut:
    return _patient_out(patients.create_patient(db, doctor, **body.model_dump()))


@router.get("/patients")
def list_patients(
    db: DbSession,
    doctor: CurrentDoctor,
    q: Annotated[str | None, Query(max_length=100, description="part of the name")] = None,
    sort: Annotated[Literal["recent", "name", "priority"], Query()] = "recent",
    status_filter: Annotated[Literal["all", "needs_review", "pending"], Query(alias="status")] = "all",
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[PatientRegistryRow]:
    found = patients.list_patients(
        db, doctor, search=q.strip() if q else None, sort=sort, status=status_filter, limit=limit, offset=offset
    )
    return [
        PatientRegistryRow(
            **_patient_out(row.patient).model_dump(),
            last_exam=LastExamOut(
                id=row.last_exam.id,
                point=row.last_exam.point,
                status=row.last_exam.status,
                created_at=row.last_exam.created_at,
                device_name=row.device_name,
                clinic=row.device_clinic,
            )
            if row.last_exam
            else None,
            result_status=row.status.result_status,
            needs_review=row.status.needs_review,
        )
        for row in found
    ]


@router.get("/patients/summary")
def patient_summary(db: DbSession, doctor: CurrentDoctor) -> PatientSummary:
    return PatientSummary(**patients.summary(db, doctor))


@router.get("/patients/{patient_id}")
def get_patient(patient_id: PathId, db: DbSession, doctor: CurrentDoctor) -> PatientOut:
    return _patient_out(patients.read_patient(db, doctor, patient_id))


@router.patch("/patients/{patient_id}")
def update_patient(patient_id: PathId, body: PatientUpdate, db: DbSession, doctor: CurrentDoctor) -> PatientOut:
    return _patient_out(patients.update_patient(db, doctor, patient_id, body.model_dump(exclude_unset=True)))


@router.delete("/patients/{patient_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_patient(patient_id: PathId, db: DbSession, doctor: CurrentDoctor) -> None:
    """Permanently erase the patient, their login, exams, results and recordings. Cannot be undone."""
    patients.delete_patient(db, doctor, patient_id)


@router.post("/patients/{patient_id}/consent")
def record_consent(patient_id: PathId, db: DbSession, doctor: CurrentDoctor) -> PatientOut:
    return _patient_out(patients.record_consent(db, doctor, patient_id))


@router.post("/patients/{patient_id}/login", status_code=status.HTTP_201_CREATED)
def create_patient_login(
    patient_id: PathId, body: PatientLoginCreate, db: DbSession, doctor: CurrentDoctor
) -> PatientLoginCreated:
    user, temp_password = patients.create_patient_login(db, doctor, patient_id, body.username)
    return PatientLoginCreated(username=user.username, temporary_password=temp_password)


@router.post("/patients/{patient_id}/vitals", status_code=status.HTTP_201_CREATED)
def record_patient_vitals(patient_id: PathId, body: VitalsCreate, db: DbSession, doctor: CurrentDoctor) -> VitalsOut:
    vitals, by = patients.record_vitals(db, doctor, patient_id, body.model_dump())
    return VitalsOut(**body.model_dump(), id=vitals.id, created_at=vitals.created_at, recorded_by=by)


@router.get("/patients/{patient_id}/vitals/latest")
def latest_patient_vitals(patient_id: PathId, db: DbSession, doctor: CurrentDoctor) -> VitalsOut | None:
    found = patients.latest_vitals(db, doctor, patient_id)
    if found is None:
        return None
    vitals, by = found
    return VitalsOut(
        **{name: getattr(vitals, name) for name in VitalsCreate.model_fields},
        id=vitals.id,
        created_at=vitals.created_at,
        recorded_by=by,
    )


@router.post("/patients/{patient_id}/reset-password")
def reset_patient_password(patient_id: PathId, db: DbSession, doctor: CurrentDoctor) -> PatientLoginCreated:
    """New one-time password for a patient who forgot theirs (shown once; must be changed on next login)."""
    user, temp_password = patients.reset_patient_password(db, doctor, patient_id)
    return PatientLoginCreated(username=user.username, temporary_password=temp_password)


@router.get("/patients/{patient_id}/exams")
def list_patient_exams(patient_id: PathId, db: DbSession, doctor: CurrentDoctor) -> list[PatientExamRow]:
    return [
        PatientExamRow(
            **ExamSummary.model_validate(row.exam).model_dump(),
            duration_s=row.duration_s,
            device_name=row.device.name if row.device else None,
            device_code=row.device.code if row.device else None,
            clinic=row.device.clinic if row.device else None,
            result_status=row.status.result_status,
            needs_review=row.status.needs_review,
            ai_label=row.ai_label,
        )
        for row in patients.list_patient_exams(db, doctor, patient_id)
    ]


# --- exams ---


@router.post("/exams", status_code=status.HTTP_201_CREATED)
def start_exam(body: ExamCreate, db: DbSession, doctor: CurrentDoctor) -> ExamDetail:
    exam = exams.start_exam(db, doctor, body.patient_id, body.device_id, body.point)
    return ExamDetail.model_validate(exam)


@router.get("/exams/{exam_id}")
def get_exam(exam_id: PathId, db: DbSession, doctor: CurrentDoctor) -> ExamDetail:
    """The web page polls this every ~2 s while the device records and the analyzer runs."""
    return ExamDetail.model_validate(exams.read_exam(db, doctor, exam_id))


@router.get("/exams/{exam_id}/audio", response_class=FileResponse)
def get_exam_audio(exam_id: PathId, db: DbSession, doctor: CurrentDoctor) -> FileResponse:
    return FileResponse(exams.exam_audio_path(db, doctor, exam_id), media_type="audio/wav")


@router.post("/exams/{exam_id}/cancel")
def cancel_exam(exam_id: PathId, db: DbSession, doctor: CurrentDoctor) -> ExamDetail:
    """Stop a waiting/recording exam that will not get its recording (e.g. device offline)."""
    return ExamDetail.model_validate(exams.cancel_exam(db, doctor, exam_id))


@router.patch("/exams/{exam_id}/review")
def review_exam(exam_id: PathId, body: ExamReview, db: DbSession, doctor: CurrentDoctor) -> ExamDetail:
    exam = exams.review_exam(db, doctor, exam_id, body.note, body.agrees_with_ai)
    return ExamDetail.model_validate(exam)


# --- devices ---


@router.get("/devices")
def list_my_devices(db: DbSession, doctor: CurrentDoctor) -> list[DoctorDeviceOut]:
    """Devices assigned to me, with online status — to pick one when starting an exam."""
    return [DoctorDeviceOut.model_validate(d) for d in devices.list_doctor_devices(db, doctor)]


# --- own profile ---


@router.get("/profile")
def my_profile(db: DbSession, doctor: CurrentDoctor) -> DoctorProfileOut:
    """The doctor's own profile: account, workload and devices. Clinic and name are changed by the admin."""
    return DoctorProfileOut.build(doctors.profile(db, doctor))


@router.get("/profile/activity")
def my_activity(
    db: DbSession, doctor: CurrentDoctor, limit: Annotated[int, Query(ge=1, le=100)] = 30
) -> list[ActivityEntryOut]:
    return [
        ActivityEntryOut.model_validate(entry, from_attributes=True)
        for entry in doctors.activity(db, doctor.id, limit=limit)
    ]
