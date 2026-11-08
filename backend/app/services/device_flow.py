"""What a device does: heartbeat, take its next command, upload a recording."""

import io
import wave
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import CommandStatus, Device, DeviceCommand, Exam, ExamStatus, Recording
from app.services import exam_flow, storage
from app.services.errors import BadRequest, Conflict, NotFound


def heartbeat(db: Session, device: Device, firmware_version: str | None, wifi_rssi: int | None) -> None:
    device.last_seen_at = datetime.now(UTC)
    if firmware_version is not None:
        device.firmware_version = firmware_version
    if wifi_rssi is not None:
        device.wifi_rssi = wifi_rssi
    db.commit()


def take_next_command(db: Session, device: Device) -> DeviceCommand | None:
    """Oldest pending command for this device; marks it taken and moves its exam to 'recording'.

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
        exam = db.get(Exam, candidate.exam_id, with_for_update=True, populate_existing=True)
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


def accept_upload(db: Session, device: Device, exam_id: int, data: bytes, motion_detected: bool) -> Exam:
    # Row lock: a retried upload arriving while the first is still saving waits here, then sees 'uploaded' → 409.
    exam = db.get(Exam, exam_id, with_for_update=True, populate_existing=True)
    if exam is None or exam.device_id != device.id:
        raise NotFound("exam not found")
    if exam.status != ExamStatus.RECORDING:
        raise Conflict(f"exam is '{exam.status.value}', not waiting for a recording")
    sample_rate, duration_s = read_wav_info(data)

    file_name = storage.save_recording(data)
    try:
        db.add(
            Recording(
                exam_id=exam.id,
                file_name=file_name,
                size_bytes=len(data),
                sample_rate=sample_rate,
                duration_s=duration_s,
                motion_detected=motion_detected,
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
        storage.delete_recording(file_name)  # never leave a WAV on disk that no row points to
        raise
    return exam
