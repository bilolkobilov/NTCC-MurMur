"""Admin: doctors, devices, system stats, audit log. Never returns patient medical data."""

from typing import Annotated

from fastapi import APIRouter, Query, status
from sqlalchemy.orm import Session

from app.deps import CurrentAdmin, DbSession
from app.models import Device
from app.schemas.admin import (
    ActivityEntryOut,
    AuditEntryOut,
    DeviceAssign,
    DeviceCreate,
    DeviceCreated,
    DeviceDisconnect,
    DeviceOut,
    DoctorCreate,
    DoctorOut,
    DoctorPasswordReset,
    DoctorPatientRow,
    DoctorProfileOut,
    DoctorUpdate,
    StatsOut,
)
from app.schemas.common import PathId
from app.services import audit, devices, doctors, stats

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _audit_out(entry, user) -> AuditEntryOut:
    return AuditEntryOut(
        id=entry.id,
        user_id=entry.user_id,
        username=user.username if user else None,
        role=user.role.value if user else None,
        action=entry.action,
        object_type=entry.object_type,
        object_id=entry.object_id,
        created_at=entry.created_at,
    )


# --- doctors ---


@router.post("/doctors", status_code=status.HTTP_201_CREATED)
def create_doctor(body: DoctorCreate, db: DbSession, _: CurrentAdmin) -> DoctorOut:
    doctor = doctors.create_doctor(
        db, username=body.username, password=body.password, full_name=body.full_name, clinic=body.clinic
    )
    return DoctorOut.model_validate(doctor)


@router.get("/doctors")
def list_doctors(db: DbSession, _: CurrentAdmin) -> list[DoctorOut]:
    return [
        DoctorOut.model_validate(doctor).model_copy(update={"patient_count": count})
        for doctor, count in doctors.list_doctors(db)
    ]


@router.get("/doctors/{doctor_id}")
def get_doctor(doctor_id: PathId, db: DbSession, _: CurrentAdmin) -> DoctorProfileOut:
    return DoctorProfileOut.build(doctors.profile(db, doctors.get_doctor(db, doctor_id)))


@router.get("/doctors/{doctor_id}/patients")
def doctor_patients(
    doctor_id: PathId,
    db: DbSession,
    admin: CurrentAdmin,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[DoctorPatientRow]:
    """Who the doctor treats (name, age, sex, last exam date). No recordings, AI results or notes."""
    return [DoctorPatientRow(**row) for row in doctors.patients_of(db, admin, doctor_id, limit=limit, offset=offset)]


@router.get("/doctors/{doctor_id}/activity")
def doctor_activity(
    doctor_id: PathId, db: DbSession, _: CurrentAdmin, limit: Annotated[int, Query(ge=1, le=100)] = 30
) -> list[ActivityEntryOut]:
    doctors.get_doctor(db, doctor_id)
    return [
        ActivityEntryOut.model_validate(entry, from_attributes=True)
        for entry in doctors.activity(db, doctor_id, limit=limit)
    ]


@router.patch("/doctors/{doctor_id}")
def update_doctor(doctor_id: PathId, body: DoctorUpdate, db: DbSession, _: CurrentAdmin) -> DoctorOut:
    """Change the doctor's name and/or clinic (blank clinic = not set)."""
    changes = body.model_dump(include=body.model_fields_set)
    return DoctorOut.model_validate(doctors.update_doctor(db, doctor_id, changes))


@router.post("/doctors/{doctor_id}/block")
def block_doctor(doctor_id: PathId, db: DbSession, _: CurrentAdmin) -> DoctorOut:
    return DoctorOut.model_validate(doctors.set_doctor_active(db, doctor_id, active=False))


@router.post("/doctors/{doctor_id}/unblock")
def unblock_doctor(doctor_id: PathId, db: DbSession, _: CurrentAdmin) -> DoctorOut:
    return DoctorOut.model_validate(doctors.set_doctor_active(db, doctor_id, active=True))


@router.post("/doctors/{doctor_id}/password")
def reset_doctor_password(doctor_id: PathId, body: DoctorPasswordReset, db: DbSession, _: CurrentAdmin) -> DoctorOut:
    """Set a new password for a doctor who forgot theirs. Their open sessions end."""
    return DoctorOut.model_validate(doctors.reset_doctor_password(db, doctor_id, body.password))


# --- devices ---


@router.post("/devices", status_code=status.HTTP_201_CREATED)
def create_device(body: DeviceCreate, db: DbSession, admin: CurrentAdmin) -> DeviceCreated:
    device, api_key = devices.create_device(
        db,
        name=body.name,
        serial=body.serial,
        doctor_id=body.doctor_id,
        model=body.model,
        location=body.location,
        admin=admin,
    )
    return DeviceCreated(**DeviceOut.build(device).model_dump(), api_key=api_key)


@router.get("/devices")
def list_devices(db: DbSession, _: CurrentAdmin) -> list[DeviceOut]:
    busy = devices.busy_ids(db)
    return [DeviceOut.build(device, busy=device.id in busy) for device in devices.list_devices(db)]


def _device_out(db: Session, device: Device) -> DeviceOut:
    return DeviceOut.build(device, busy=device.id in devices.busy_ids(db))


@router.get("/devices/{device_id}")
def get_device(device_id: PathId, db: DbSession, _: CurrentAdmin) -> DeviceOut:
    return _device_out(db, devices.get_device(db, device_id))


@router.patch("/devices/{device_id}")
def assign_device(device_id: PathId, body: DeviceAssign, db: DbSession, admin: CurrentAdmin) -> DeviceOut:
    return _device_out(db, devices.assign_device(db, admin, device_id, body.doctor_id))


@router.delete("/devices/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_device(device_id: PathId, db: DbSession, admin: CurrentAdmin) -> None:
    """Remove the device record. 409 if it already has exams (disconnect it instead)."""
    devices.delete_device(db, admin, device_id)


@router.post("/devices/{device_id}/rotate-key")
def rotate_device_key(device_id: PathId, db: DbSession, admin: CurrentAdmin) -> DeviceCreated:
    """Issue a new key (shown once). The old key stops working at once; put the new one into the firmware."""
    device, api_key = devices.rotate_key(db, admin, device_id)
    return DeviceCreated(**DeviceOut.build(device).model_dump(), api_key=api_key)


@router.post("/devices/{device_id}/disconnect")
def disconnect_device(device_id: PathId, body: DeviceDisconnect, db: DbSession, admin: CurrentAdmin) -> DeviceOut:
    """Block a device from the API. It keeps recording locally; doctors can no longer pick it."""
    return _device_out(db, devices.disconnect(db, admin, device_id, body.reason))


@router.post("/devices/{device_id}/reconnect")
def reconnect_device(device_id: PathId, db: DbSession, admin: CurrentAdmin) -> DeviceOut:
    return _device_out(db, devices.reconnect(db, admin, device_id))


@router.post("/devices/{device_id}/self-test", status_code=status.HTTP_202_ACCEPTED)
def self_test_device(device_id: PathId, db: DbSession, admin: CurrentAdmin) -> DeviceOut:
    """Queue a self-test; the result arrives with the device's next poll and shows in the health checks."""
    return _device_out(db, devices.request_self_test(db, admin, device_id))


@router.get("/devices/{device_id}/activity")
def device_activity(
    device_id: PathId, db: DbSession, _: CurrentAdmin, limit: Annotated[int, Query(ge=1, le=100)] = 30
) -> list[AuditEntryOut]:
    return [_audit_out(entry, user) for entry, user in devices.activity(db, device_id, limit=limit)]


# --- system ---


@router.get("/stats")
def get_stats(db: DbSession, _: CurrentAdmin) -> StatsOut:
    return StatsOut(**stats.system_stats(db))


@router.get("/audit")
def list_audit(
    db: DbSession,
    _: CurrentAdmin,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
    action: Annotated[str | None, Query(pattern=r"^[a-z_]+(\.[a-z_]+)*$", max_length=64)] = None,
) -> list[AuditEntryOut]:
    return [
        _audit_out(entry, user) for entry, user in audit.list_entries(db, limit=limit, offset=offset, action=action)
    ]
