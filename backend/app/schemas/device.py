from pydantic import BaseModel, ConfigDict, Field


class Heartbeat(BaseModel):
    firmware_version: str | None = Field(default=None, max_length=32)
    wifi_rssi: int | None = Field(default=None, ge=-127, le=0, description="Wi-Fi signal strength in dBm")
    battery_pct: int | None = Field(default=None, ge=0, le=100)
    mic_noise_db: int | None = Field(default=None, ge=0, le=140, description="Microphone noise floor")
    wifi_ssid: str | None = Field(default=None, max_length=32)
    ip: str | None = Field(default=None, max_length=45)
    mac: str | None = Field(default=None, max_length=17)
    gateway: str | None = Field(default=None, max_length=45)


class CommandOut(BaseModel):
    command: str  # "record" or "self_test"
    exam_id: int | None  # none for self_test
    duration_s: int


class UploadMeta(BaseModel):
    """JSON sent next to the WAV. Unknown keys are ignored, so firmware can add fields (e.g. ECG) later."""

    model_config = ConfigDict(extra="ignore")

    motion_detected: bool = False
    sample_rate: int | None = None  # informative; the WAV header is what we trust
    # The optional `ecg` part (firmware/murmur/ecg.h): int32 little-endian, channels interleaved.
    ecg_sample_rate: int = Field(default=250, ge=125, le=1000)
    ecg_channels: int = Field(default=2, ge=1, le=2)
    ecg_gain: int = Field(default=6, ge=1, le=12)  # ADS1292R PGA gain
    ecg_vref_mv: float = Field(default=2420.0, gt=0, le=5000)
    ecg_lead_off: bool = False  # an electrode came off at some point during the recording


class UploadAccepted(BaseModel):
    exam_id: int
    status: str


class SelfTestResult(BaseModel):
    ok: bool
    mic_noise_db: int | None = Field(default=None, ge=0, le=140)
