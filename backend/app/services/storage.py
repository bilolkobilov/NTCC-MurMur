"""Where WAV files live on disk. File names are random UUIDs — never patient names."""

import uuid
from pathlib import Path

from app.config import get_settings


def new_file_name() -> str:
    return f"{uuid.uuid4().hex}.wav"


def recording_path(file_name: str) -> Path:
    folder = get_settings().recordings_path
    path = (folder / file_name).resolve()
    if path.parent != folder.resolve():  # file names come from our DB, but never allow escaping the folder
        raise ValueError("invalid recording file name")
    return path


def save_recording(data: bytes) -> str:
    """Write bytes to a new random file and return its file name."""
    folder = get_settings().recordings_path
    folder.mkdir(parents=True, exist_ok=True)
    file_name = new_file_name()
    (folder / file_name).write_bytes(data)
    return file_name
