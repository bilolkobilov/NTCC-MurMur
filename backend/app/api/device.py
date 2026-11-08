"""Device endpoints. Authenticated only by the `X-Device-Key` header."""

from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, Response, UploadFile, status
from pydantic import ValidationError

from app.config import get_settings
from app.deps import CurrentDevice, DbSession
from app.schemas.device import CommandOut, Heartbeat, UploadAccepted, UploadMeta
from app.services import analysis, device_flow

router = APIRouter(prefix="/api/device", tags=["device"])


@router.post("/heartbeat")
def heartbeat(body: Heartbeat, db: DbSession, device: CurrentDevice) -> dict[str, str]:
    """Sent every ~10 s. A device is 'online' if seen in the last 30 s."""
    device_flow.heartbeat(db, device, body.firmware_version, body.wifi_rssi)
    return {"status": "ok"}


@router.get(
    "/command",
    responses={204: {"description": "No command waiting"}},
)
def poll_command(db: DbSession, device: CurrentDevice) -> CommandOut | None:
    """Polled every 1–2 s. Returns the next command once, or 204 when there is nothing to do."""
    command = device_flow.take_next_command(db, device)
    if command is None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    return CommandOut(command=command.command, exam_id=command.exam_id, duration_s=command.duration_s)


@router.post("/upload/{exam_id}", status_code=status.HTTP_202_ACCEPTED)
def upload(
    exam_id: int,
    audio: Annotated[UploadFile, File(description="WAV recording")],
    db: DbSession,
    device: CurrentDevice,
    background: BackgroundTasks,
    meta: Annotated[str | None, Form(description='JSON, e.g. {"motion_detected": false, "sample_rate": 4000}')] = None,
) -> UploadAccepted:
    """Accepts the WAV, then analysis runs in the background (the device does not wait for it)."""
    try:
        parsed_meta = UploadMeta.model_validate_json(meta) if meta else UploadMeta()
    except ValidationError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"invalid meta JSON: {exc.errors()[0]['msg']}")

    limit = get_settings().max_upload_mb * 1024 * 1024
    data = audio.file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, f"audio is larger than {get_settings().max_upload_mb} MB")

    exam = device_flow.accept_upload(db, device, exam_id, data, parsed_meta.motion_detected)
    background.add_task(analysis.run_analysis, exam.id)
    return UploadAccepted(exam_id=exam.id, status=exam.status.value)
