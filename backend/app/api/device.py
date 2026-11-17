"""Device endpoints. Authenticated only by the `X-Device-Key` header."""

from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, Response, UploadFile, status
from pydantic import ValidationError

from app.config import get_settings
from app.deps import CurrentDevice, DbSession
from app.schemas.common import PathId
from app.schemas.device import CommandOut, Heartbeat, SelfTestResult, UploadAccepted, UploadMeta
from app.services import analysis, device_flow

router = APIRouter(prefix="/api/device", tags=["device"])


@router.post("/heartbeat")
def heartbeat(body: Heartbeat, db: DbSession, device: CurrentDevice) -> dict[str, str]:
    """Sent every ~10 s. A device is 'online' if seen in the last 30 s."""
    device_flow.heartbeat(db, device, **body.model_dump())
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


@router.post("/self-test")
def self_test_result(body: SelfTestResult, db: DbSession, device: CurrentDevice) -> dict[str, str]:
    """The device's answer to a self_test command."""
    device_flow.report_self_test(db, device, body.ok, body.mic_noise_db)
    return {"status": "ok"}


@router.post("/upload/{exam_id}", status_code=status.HTTP_202_ACCEPTED)
def upload(
    exam_id: PathId,
    audio: Annotated[UploadFile, File(description="WAV recording")],
    db: DbSession,
    device: CurrentDevice,
    background: BackgroundTasks,
    meta: Annotated[str | None, Form(description='JSON, e.g. {"motion_detected": false, "sample_rate": 4000}')] = None,
    ecg: Annotated[
        UploadFile | None, File(description="Optional ECG: int32 little-endian, channels interleaved")
    ] = None,
) -> UploadAccepted:
    """Accepts the WAV (and the ECG recorded with it), then analysis runs in the background."""
    try:
        parsed_meta = UploadMeta.model_validate_json(meta) if meta else UploadMeta()
    except ValidationError as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, f"invalid meta JSON: {exc.errors()[0]['msg']}"
        ) from None

    limit = get_settings().max_upload_mb * 1024 * 1024
    data = audio.file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(
            status.HTTP_413_CONTENT_TOO_LARGE, f"audio is larger than {get_settings().max_upload_mb} MB"
        )

    ecg_data = None
    if ecg is not None:
        ecg_data = ecg.file.read(device_flow.MAX_ECG_BYTES + 1)
        if len(ecg_data) > device_flow.MAX_ECG_BYTES:
            raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "ecg is too large")

    exam = device_flow.accept_upload(db, device, exam_id, data, parsed_meta, ecg_data)
    background.add_task(analysis.run_analysis, exam.id)
    return UploadAccepted(exam_id=exam.id, status=exam.status.value)
