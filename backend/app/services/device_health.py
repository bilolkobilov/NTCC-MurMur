"""Device health, derived from what the device reported. Pure rules, no database (like result_status.py).

Thresholds come from the owner-approved mockup (2026-11-15): battery below 30 % warns, below 15 % fails; microphone
noise floor limit 35 dB; weak Wi-Fi is -72 dBm or lower (the same cut-off the web app uses for "weak").
"""

from app.config import get_settings
from app.models import Device

BATTERY_WARN = 30
BATTERY_FAIL = 15
MIC_NOISE_LIMIT_DB = 35
WEAK_RSSI = -72


def latest_firmware() -> str | None:
    return get_settings().latest_firmware or None


def state(device: Device) -> str:
    """disconnected (admin) > pending (never seen: not paired yet) > online > offline."""
    if device.disconnected_at is not None:
        return "disconnected"
    if device.last_seen_at is None:
        return "pending"
    return "online" if device.online else "offline"


def checks(device: Device) -> dict[str, str]:
    """Each check is pass / warn / fail / nodata."""
    latest = latest_firmware()
    result: dict[str, str] = {
        "connection": "nodata" if device.last_seen_at is None else ("pass" if device.online else "fail"),
        "battery": "nodata"
        if device.battery_pct is None
        else "fail"
        if device.battery_pct < BATTERY_FAIL
        else "warn"
        if device.battery_pct < BATTERY_WARN
        else "pass",
        "signal": "nodata" if device.wifi_rssi is None else ("warn" if device.wifi_rssi <= WEAK_RSSI else "pass"),
        "firmware": "nodata"
        if device.firmware_version is None or latest is None
        else ("pass" if device.firmware_version == latest else "warn"),
        "microphone": "nodata"
        if device.mic_noise_db is None
        else ("warn" if device.mic_noise_db > MIC_NOISE_LIMIT_DB else "pass"),
        "self_test": "nodata" if device.last_self_test_ok is None else ("pass" if device.last_self_test_ok else "fail"),
    }
    return result


def health(device: Device) -> str:
    """pending (never seen) · fault (any fail) · degraded (noisy microphone) · attention (other warnings) · healthy."""
    if device.last_seen_at is None:
        return "pending"
    values = checks(device)
    if "fail" in values.values():
        return "fault"
    if values["microphone"] == "warn":
        return "degraded"
    if "warn" in values.values():
        return "attention"
    return "healthy"
