"""Where WAV and ECG files live on disk. File names are random UUIDs — never patient names."""

import uuid
from pathlib import Path

from app.config import get_settings


def new_file_name(suffix: str = ".wav") -> str:
    return f"{uuid.uuid4().hex}{suffix}"


def recording_path(file_name: str) -> Path:
    folder = get_settings().recordings_path
    path = (folder / file_name).resolve()
    if path.parent != folder.resolve():  # file names come from our DB, but never allow escaping the folder
        raise ValueError("invalid recording file name")
    return path


def save_recording(data: bytes, suffix: str = ".wav") -> str:
    """Write bytes to a new random file and return its file name (`.wav` sound, `.ecg` ECG)."""
    folder = get_settings().recordings_path
    folder.mkdir(parents=True, exist_ok=True)
    file_name = new_file_name(suffix)
    (folder / file_name).write_bytes(data)
    return file_name


def delete_recording(file_name: str) -> None:
    recording_path(file_name).unlink(missing_ok=True)
