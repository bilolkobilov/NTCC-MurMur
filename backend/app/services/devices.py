"""Devices: registration with a one-time API key, assignment to a doctor. Online status: `Device.online`."""

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Device, User
from app.security import generate_api_key, hash_api_key
from app.services.doctors import get_doctor
from app.services.errors import BadRequest, Conflict, NotFound


def _check_assignable_doctor(db: Session, doctor_id: int | None) -> None:
    if doctor_id is None:
        return
    try:
        doctor = get_doctor(db, doctor_id)
    except NotFound:
        raise BadRequest("doctor_id is not a doctor") from None
    if not doctor.is_active:
        raise BadRequest("doctor is blocked")


def create_device(
    db: Session, *, name: str, serial: str, doctor_id: int | None, api_key: str | None = None
) -> tuple[Device, str]:
    """Returns the device and its plain API key. The key is never stored and cannot be shown again.

    `api_key` is only passed by the demo seed (app.cli), which needs a key the fake device already knows."""
    if db.scalar(select(Device.id).where(Device.serial == serial)) is not None:
        raise Conflict("serial already exists")
    _check_assignable_doctor(db, doctor_id)
    api_key = api_key or generate_api_key()
    device = Device(name=name, serial=serial, doctor_id=doctor_id, api_key_hash=hash_api_key(api_key))
    db.add(device)
    try:
        db.commit()
    except IntegrityError:  # a parallel request registered the same serial after our check
        db.rollback()
        raise Conflict("serial already exists") from None
    return device, api_key


def list_devices(db: Session) -> list[Device]:
    return list(db.scalars(select(Device).order_by(Device.id)))


def list_doctor_devices(db: Session, doctor: User) -> list[Device]:
    """Devices assigned to this doctor — the ones they can start exams on."""
    return list(db.scalars(select(Device).where(Device.doctor_id == doctor.id).order_by(Device.id)))


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


def rotate_key(db: Session, device_id: int) -> tuple[Device, str]:
    """New API key for a device (old one lost or leaked). The old key stops working immediately."""
    device = get_device(db, device_id)
    api_key = generate_api_key()
    device.api_key_hash = hash_api_key(api_key)
    db.commit()
    return device, api_key
