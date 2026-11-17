"""Devices: registration with a one-time API key, assignment to a doctor. Online status: `Device.online`."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.models import AuditLog, CommandStatus, Device, DeviceCommand, Exam, ExamStatus, User
from app.security import generate_api_key, hash_api_key
from app.services import audit, exam_flow
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
    db: Session,
    *,
    name: str | None,
    serial: str,
    doctor_id: int | None,
    model: str = "MurMur S2",
    location: str | None = None,
    api_key: str | None = None,
    admin: User | None = None,
) -> tuple[Device, str]:
    """Returns the device and its plain API key. The key is never stored and cannot be shown again.

    `api_key` is only passed by the demo seed (app.cli), which needs a key the fake device already knows."""
    if db.scalar(select(Device.id).where(Device.serial == serial)) is not None:
        raise Conflict("serial already exists")
    _check_assignable_doctor(db, doctor_id)
    api_key = api_key or generate_api_key()
    device = Device(
        name=(name or "").strip() or "-",
        serial=serial,
        doctor_id=doctor_id,
        model=model,
        location=(location or "").strip() or None,
        api_key_hash=hash_api_key(api_key),
    )
    db.add(device)
    try:
        db.flush()
    except IntegrityError:  # a parallel request registered the same serial after our check
        db.rollback()
        raise Conflict("serial already exists") from None
    if device.name == "-":
        device.name = device.code  # no name given: the device is called by its code
    db.commit()
    if admin is not None:
        audit.record(db, admin, "device.create", "device", device.id)
    return device, api_key


def list_devices(db: Session) -> list[Device]:
    return list(db.scalars(select(Device).options(selectinload(Device.doctor)).order_by(Device.id)))


def busy_ids(db: Session) -> set[int]:
    """Devices that are recording an exam right now."""
    return set(db.scalars(select(Exam.device_id).where(Exam.status == ExamStatus.RECORDING)))


def list_doctor_devices(db: Session, doctor: User) -> list[Device]:
    """Devices assigned to this doctor — the ones they can start exams on (not the ones the admin disconnected)."""
    return list(
        db.scalars(
            select(Device).where(Device.doctor_id == doctor.id, Device.disconnected_at.is_(None)).order_by(Device.id)
        )
    )


def get_device(db: Session, device_id: int) -> Device:
    device = db.get(Device, device_id)
    if device is None:
        raise NotFound("device not found")
    return device


SELF_TEST_TIMEOUT_S = 60  # a self-test the device took but never reported is given up after this
LEAKED_KEY_REASONS = {"lost", "security"}  # the old key may be in someone else's hands


def _close_waiting_exams(db: Session, device: Device, reason: str) -> None:
    """Exams still waiting for this device fail now. Otherwise its pending command would run on the next poll, even
    days later, and record a patient for the wrong doctor or after the admin took the device away."""
    for exam in db.scalars(
        select(Exam)
        .where(Exam.device_id == device.id, Exam.status == ExamStatus.WAITING)
        .order_by(Exam.id)
        .with_for_update()
    ):
        exam_flow.cancel(db, exam, reason, commit=False)


def assign_device(db: Session, admin: User, device_id: int, doctor_id: int | None) -> Device:
    device = get_device(db, device_id)
    _check_assignable_doctor(db, doctor_id)
    if doctor_id != device.doctor_id:
        if device.id in busy_ids(db):
            raise Conflict("device is recording an exam")
        _close_waiting_exams(db, device, "device was given to another doctor")
    device.doctor_id = doctor_id
    db.commit()
    audit.record(db, admin, "device.assign", "device", device.id)
    return device


def rotate_key(db: Session, admin: User, device_id: int) -> tuple[Device, str]:
    """New API key for a device (old one lost or leaked). The old key stops working immediately."""
    device = get_device(db, device_id)
    api_key = generate_api_key()
    device.api_key_hash = hash_api_key(api_key)
    db.commit()
    audit.record(db, admin, "device.rotate_key", "device", device.id)
    return device, api_key


def disconnect(db: Session, admin: User, device_id: int, reason: str) -> Device:
    """Block the device from the API (it keeps recording locally). Not while it is recording an exam.

    Its waiting exams fail. For a lost or compromised device the key is also destroyed: after a reconnect the admin
    issues a new one with "rotate key", so a stolen key never works again.
    """
    device = get_device(db, device_id)
    if device.disconnected_at is not None:
        raise Conflict("device is already disconnected")
    if device.id in busy_ids(db):
        raise Conflict("device is recording an exam")
    _close_waiting_exams(db, device, "device was disconnected by the administrator")
    if reason in LEAKED_KEY_REASONS:
        device.api_key_hash = hash_api_key(generate_api_key())  # a key nobody knows
    device.disconnected_at = datetime.now(UTC)
    device.disconnect_reason = reason
    db.commit()
    audit.record(db, admin, f"device.disconnect.{reason}", "device", device.id)
    return device


def reconnect(db: Session, admin: User, device_id: int) -> Device:
    device = get_device(db, device_id)
    if device.disconnected_at is None:
        raise Conflict("device is not disconnected")
    device.disconnected_at = None
    device.disconnect_reason = None
    db.commit()
    audit.record(db, admin, "device.reconnect", "device", device.id)
    return device


def request_self_test(db: Session, admin: User, device_id: int) -> Device:
    """Queue a self-test: the device picks it up on its next poll and reports the result."""
    device = get_device(db, device_id)
    if device.disconnected_at is not None:
        raise Conflict("device is disconnected")
    if not device.online:
        raise Conflict("device is offline")
    now = datetime.now(UTC)
    for stale in db.scalars(  # taken but never reported (device rebooted, Wi-Fi lost): give it up
        select(DeviceCommand).where(
            DeviceCommand.device_id == device.id,
            DeviceCommand.command == "self_test",
            DeviceCommand.status == CommandStatus.TAKEN,
            DeviceCommand.taken_at < now - timedelta(seconds=SELF_TEST_TIMEOUT_S),
        )
    ):
        stale.status = CommandStatus.DONE
        stale.done_at = now
    waiting = db.scalar(
        select(DeviceCommand.id).where(
            DeviceCommand.device_id == device.id,
            DeviceCommand.command == "self_test",
            DeviceCommand.status.in_([CommandStatus.PENDING, CommandStatus.TAKEN]),
        )
    )
    if waiting is None:
        db.add(DeviceCommand(device_id=device.id, exam_id=None, command="self_test", duration_s=0))
        db.commit()
        audit.record(db, admin, "device.self_test", "device", device.id)
    return device


def activity(db: Session, device_id: int, *, limit: int) -> list[tuple[AuditLog, User | None]]:
    """Admin actions on this device, newest first."""
    get_device(db, device_id)
    rows = db.execute(
        select(AuditLog, User)
        .outerjoin(User, User.id == AuditLog.user_id)
        .where(AuditLog.object_type == "device", AuditLog.object_id == device_id)
        .order_by(AuditLog.id.desc())
        .limit(limit)
    )
    return [(entry, user) for entry, user in rows]
