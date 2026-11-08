from pydantic import BaseModel, ConfigDict, Field


class Heartbeat(BaseModel):
    firmware_version: str | None = Field(default=None, max_length=32)
    wifi_rssi: int | None = Field(default=None, ge=-127, le=0, description="Wi-Fi signal strength in dBm")


class CommandOut(BaseModel):
    command: str
    exam_id: int
    duration_s: int


class UploadMeta(BaseModel):
    """JSON sent next to the WAV. Unknown keys are ignored, so firmware can add fields (e.g. ECG) later."""

    model_config = ConfigDict(extra="ignore")

    motion_detected: bool = False
    sample_rate: int | None = None  # informative; the WAV header is what we trust


class UploadAccepted(BaseModel):
    exam_id: int
    status: str
