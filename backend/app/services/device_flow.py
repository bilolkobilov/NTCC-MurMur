"""What a device does: heartbeat, take its next command, upload a recording."""

import io
import wave
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import CommandStatus, Device, DeviceCommand, EcgRecording, EcgResult, Exam, ExamStatus, Recording
from app.schemas.device import UploadMeta
from app.services import ecg as ecg_service
from app.services import exam_flow, storage
from app.services.errors import BadRequest, Conflict, NotFound

HEARTBEAT_FIELDS = ("firmware_version", "wifi_rssi", "battery_pct", "mic_noise_db", "wifi_ssid", "ip", "mac", "gateway")


def heartbeat(db: Session, device: Device, **reported: object) -> None:
    """Store what the device reported (only the values it sent: a device that lacks a sensor omits it).

    Only these device columns are ever written, whatever else the request schema may carry one day."""
    device.last_seen_at = datetime.now(UTC)
    for field in HEARTBEAT_FIELDS:
        value = reported.get(field)
        if value is not None:
            setattr(device, field, value)
    db.commit()


def report_self_test(db: Session, device: Device, ok: bool, mic_noise_db: int | None) -> None:
    """The device's answer to a self_test command: store it and close the command."""
    device.last_seen_at = datetime.now(UTC)
    device.last_self_test_at = datetime.now(UTC)
    device.last_self_test_ok = ok
    if mic_noise_db is not None:
        device.mic_noise_db = mic_noise_db
    for command in db.scalars(
        select(DeviceCommand).where(
            DeviceCommand.device_id == device.id,
            DeviceCommand.command == "self_test",
            DeviceCommand.status == CommandStatus.TAKEN,
        )
    ):
        command.status = CommandStatus.DONE
        command.done_at = datetime.now(UTC)
    db.commit()


def take_next_command(db: Session, device: Device) -> DeviceCommand | None:
    """Oldest pending command for this device; marks it taken and moves its exam to 'recording'
    (a self_test has no exam).

    Lock order is always EXAM, then its COMMAND — the same order as upload, cancel and patient delete — so these
    can never deadlock each other. After the exam lock is held the command is re-read: a parallel poll may have
    taken it meanwhile (then we move on), so a command is never handed out twice.
    A command whose exam is no longer 'waiting' (e.g. the exam was cancelled) is closed and skipped,
    so it can never block the commands behind it.
    """
    device.last_seen_at = datetime.now(UTC)  # polling also proves the device is alive
    while True:
        candidate = db.execute(
            select(DeviceCommand.id, DeviceCommand.exam_id)
            .where(DeviceCommand.device_id == device.id, DeviceCommand.status == CommandStatus.PENDING)
            .order_by(DeviceCommand.id)
            .limit(1)
        ).first()
        if candidate is None:
            db.commit()
            return None
        exam = (
            None
            if candidate.exam_id is None
            else db.get(Exam, candidate.exam_id, with_for_update=True, populate_existing=True)
        )
        command = db.scalar(
            select(DeviceCommand)
            .where(DeviceCommand.id == candidate.id, DeviceCommand.status == CommandStatus.PENDING)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if command is None:  # taken by a parallel poll (or deleted) while we waited for the exam lock
            continue
        command.status = CommandStatus.TAKEN
        command.taken_at = datetime.now(UTC)
        if candidate.exam_id is None:  # self_test: no exam; it is closed when the device reports (report_self_test)
            db.commit()
            return command
        if exam is not None and exam.status == ExamStatus.WAITING:
            exam_flow.mark_recording(exam)
            db.commit()
            return command
        command.status = CommandStatus.DONE  # stale: nothing to record any more
        command.done_at = datetime.now(UTC)
        db.flush()


def read_wav_info(data: bytes) -> tuple[int, float]:
    """Return (sample_rate, duration_s). Raises BadRequest if the bytes are not a readable PCM WAV."""
    if len(data) < 12 or data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise BadRequest("audio must be a WAV file")
    try:
        with wave.open(io.BytesIO(data)) as wav:
            sample_rate = wav.getframerate()
            frames = wav.getnframes()
    except wave.Error, EOFError:
        raise BadRequest("audio must be a valid PCM WAV file") from None
    if sample_rate <= 0 or frames <= 0:
        raise BadRequest("audio WAV is empty")
    return sample_rate, frames / sample_rate


MAX_ECG_BYTES = 1024 * 1024  # 35 s x 1000 Hz x 2 channels x 4 bytes = 280 KB, so 1 MB is plenty


def check_ecg(data: bytes, meta: UploadMeta) -> float:
    """Return the ECG length in seconds. Raises BadRequest if the bytes cannot be this device's ECG."""
    frame = 4 * meta.ecg_channels
    if not data or len(data) % frame:
        raise BadRequest("ecg length does not match its channel count")
    seconds = len(data) / frame / meta.ecg_sample_rate
    if not ecg_service.MIN_SECONDS <= seconds <= ecg_service.MAX_SECONDS:
        raise BadRequest(f"ecg must be {ecg_service.MIN_SECONDS:g}-{ecg_service.MAX_SECONDS:g} s long")
    return seconds


def accept_upload(
    db: Session, device: Device, exam_id: int, data: bytes, meta: UploadMeta, ecg: bytes | None = None
) -> Exam:
    # Row lock: a retried upload arriving while the first is still saving waits here, then sees 'uploaded' → 409.
    exam = db.get(Exam, exam_id, with_for_update=True, populate_existing=True)
    if exam is None or exam.device_id != device.id:
        raise NotFound("exam not found")
    if exam.status != ExamStatus.RECORDING:
        raise Conflict(f"exam is '{exam.status.value}', not waiting for a recording")
    sample_rate, duration_s = read_wav_info(data)
    ecg_seconds, ecg_invalid = None, False
    if ecg is not None:
        try:
            ecg_seconds = check_ecg(ecg, meta)
        except BadRequest:  # a broken ECG must never cost the heart sound (owner, 2026-11-17)
            ecg_invalid = True

    file_name, ecg_file = storage.save_recording(data), None
    try:
        if ecg_seconds is not None:
            ecg_file = storage.save_recording(ecg, ".ecg")
        db.add(
            Recording(
                exam_id=exam.id,
                file_name=file_name,
                size_bytes=len(data),
                sample_rate=sample_rate,
                duration_s=duration_s,
                motion_detected=meta.motion_detected,
            )
        )
        if ecg_file is not None:
            db.add(
                EcgRecording(
                    exam_id=exam.id,
                    file_name=ecg_file,
                    size_bytes=len(ecg),
                    sample_rate=meta.ecg_sample_rate,
                    channels=meta.ecg_channels,
                    duration_s=ecg_seconds,
                    gain=meta.ecg_gain,
                    vref_mv=meta.ecg_vref_mv,
                    lead_off=meta.ecg_lead_off,
                )
            )
        if ecg_invalid:  # nothing worth keeping: the doctor sees "cannot judge" with this reason
            db.add(
                EcgResult(
                    exam_id=exam.id,
                    method_version=ecg_service.METHOD_VERSION,
                    quality="bad",
                    problem=ecg_service.INVALID,
                )
            )
        command = db.scalar(
            select(DeviceCommand).where(DeviceCommand.exam_id == exam.id, DeviceCommand.status == CommandStatus.TAKEN)
        )
        if command is not None:
            command.status = CommandStatus.DONE
            command.done_at = datetime.now(UTC)
        exam_flow.mark_uploaded(exam)
        db.commit()
    except Exception:
        db.rollback()
        for saved in (file_name, ecg_file):  # never leave a file on disk that no row points to
            if saved is not None:
                storage.delete_recording(saved)
        raise
    return exam
