"""Devices: registration with a one-time API key, assignment to a doctor, online status."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Device
from app.security import generate_api_key, hash_api_key
from app.services.doctors import get_doctor
from app.services.errors import BadRequest, Conflict, NotFound

ONLINE_WINDOW = timedelta(seconds=30)


def is_online(device: Device, now: datetime | None = None) -> bool:
    if device.last_seen_at is None:
        return False
    return (now or datetime.now(UTC)) - device.last_seen_at <= ONLINE_WINDOW


def _check_assignable_doctor(db: Session, doctor_id: int | None) -> None:
    if doctor_id is None:
        return
    try:
        doctor = get_doctor(db, doctor_id)
    except NotFound:
        raise BadRequest("doctor_id is not a doctor") from None
    if not doctor.is_active:
        raise BadRequest("doctor is blocked")


def create_device(db: Session, *, name: str, serial: str, doctor_id: int | None) -> tuple[Device, str]:
    """Returns the device and its plain API key. The key is never stored and cannot be shown again."""
    if db.scalar(select(Device.id).where(Device.serial == serial)) is not None:
        raise Conflict("serial already exists")
    _check_assignable_doctor(db, doctor_id)
    api_key = generate_api_key()
    device = Device(name=name, serial=serial, doctor_id=doctor_id, api_key_hash=hash_api_key(api_key))
    db.add(device)
    db.commit()
    return device, api_key


def list_devices(db: Session) -> list[Device]:
    return list(db.scalars(select(Device).order_by(Device.id)))


def get_device(db: Session, device_id: int) -> Device:
    device = db.get(Device, device_id)
    if device is None:
        raise NotFound("device not found")
    return device


def assign_device(db: Session, device_id: int, doctor_id: int | None) -> Device:
    device = get_device(db, device_id)
    _check_assignable_doctor(db, doctor_id)
    device.doctor_id = doctor_id
    db.commit()
    return device
