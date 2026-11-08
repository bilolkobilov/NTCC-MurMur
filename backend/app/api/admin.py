"""Admin: doctors, devices, system stats, audit log. Never returns patient medical data."""

from typing import Annotated

from fastapi import APIRouter, Query, status

from app.deps import CurrentAdmin, DbSession
from app.models import Device
from app.schemas.admin import (
    AuditEntryOut,
    DeviceAssign,
    DeviceCreate,
    DeviceCreated,
    DeviceOut,
    DoctorCreate,
    DoctorOut,
    StatsOut,
)
from app.services import audit, devices, doctors, stats

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _device_out(device: Device) -> DeviceOut:
    return DeviceOut(
        id=device.id,
        name=device.name,
        serial=device.serial,
        doctor_id=device.doctor_id,
        online=devices.is_online(device),
        last_seen_at=device.last_seen_at,
        wifi_rssi=device.wifi_rssi,
        firmware_version=device.firmware_version,
        created_at=device.created_at,
    )


# --- doctors ---


@router.post("/doctors", status_code=status.HTTP_201_CREATED)
def create_doctor(body: DoctorCreate, db: DbSession, _: CurrentAdmin) -> DoctorOut:
    doctor = doctors.create_doctor(db, username=body.username, password=body.password, full_name=body.full_name)
    return DoctorOut.model_validate(doctor)


@router.get("/doctors")
def list_doctors(db: DbSession, _: CurrentAdmin) -> list[DoctorOut]:
    return [
        DoctorOut.model_validate(doctor).model_copy(update={"patient_count": count})
        for doctor, count in doctors.list_doctors(db)
    ]


@router.post("/doctors/{doctor_id}/block")
def block_doctor(doctor_id: int, db: DbSession, _: CurrentAdmin) -> DoctorOut:
    return DoctorOut.model_validate(doctors.set_doctor_active(db, doctor_id, active=False))


@router.post("/doctors/{doctor_id}/unblock")
def unblock_doctor(doctor_id: int, db: DbSession, _: CurrentAdmin) -> DoctorOut:
    return DoctorOut.model_validate(doctors.set_doctor_active(db, doctor_id, active=True))


# --- devices ---


@router.post("/devices", status_code=status.HTTP_201_CREATED)
def create_device(body: DeviceCreate, db: DbSession, _: CurrentAdmin) -> DeviceCreated:
    device, api_key = devices.create_device(db, name=body.name, serial=body.serial, doctor_id=body.doctor_id)
    return DeviceCreated(**_device_out(device).model_dump(), api_key=api_key)


@router.get("/devices")
def list_devices(db: DbSession, _: CurrentAdmin) -> list[DeviceOut]:
    return [_device_out(device) for device in devices.list_devices(db)]


@router.patch("/devices/{device_id}")
def assign_device(device_id: int, body: DeviceAssign, db: DbSession, _: CurrentAdmin) -> DeviceOut:
    return _device_out(devices.assign_device(db, device_id, body.doctor_id))


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
) -> list[AuditEntryOut]:
    return [
        AuditEntryOut(
            id=entry.id,
            user_id=entry.user_id,
            username=user.username if user else None,
            role=user.role.value if user else None,
            action=entry.action,
            object_type=entry.object_type,
            object_id=entry.object_id,
            created_at=entry.created_at,
        )
        for entry, user in audit.list_entries(db, limit=limit, offset=offset)
    ]
