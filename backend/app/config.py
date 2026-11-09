"""App settings, read from environment variables and the repo-root `.env` file."""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import URL

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=REPO_ROOT / ".env", extra="ignore")

    postgres_user: str
    postgres_password: str
    postgres_db: str
    postgres_host: str = "localhost"
    postgres_port: int = 5432

    jwt_secret: str
    jwt_expire_minutes: int = 480  # 8 hours = one working day (owner, 2026-11-08)
    bcrypt_rounds: int = 12  # tests lower this to stay fast
    login_max_failures: int = 5  # wrong passwords per (IP, username) ...
    login_lock_minutes: int = 15  # ... within this many minutes → login blocked for the rest of the window

    first_admin_username: str = "admin"
    first_admin_password: str | None = None

    # Docker demo only (docker-compose.yml): `app.cli seed-demo` creates a doctor + a device with this key.
    demo_device_key: str | None = None
    demo_doctor_password: str = "demo-doctor-1"

    app_timezone: str = "Asia/Tashkent"  # what "today" means in admin stats
    cors_origins: str = ""
    recordings_dir: Path = Path("storage/recordings")
    frontend_dist: Path = Path("frontend/dist")  # built web app; served at / when it exists
    max_upload_mb: int = 10
    min_recording_seconds: int = 10  # shorter recordings are rejected as "re-record"
    # Which analyzer runs after upload. "cardiophon" needs `uv sync --group ai` + model files (docs/runbook.md);
    # if they are missing the server logs it and uses "dummy" (no AI opinion).
    ai_model: Literal["dummy", "cardiophon"] = "dummy"
    ai_model_dir: Path = Path("models")

    @property
    def database_url(self) -> URL:
        return URL.create(
            "postgresql+psycopg",
            username=self.postgres_user,
            password=self.postgres_password,
            host=self.postgres_host,
            port=self.postgres_port,
            database=self.postgres_db,
        )

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def frontend_dist_path(self) -> Path:
        path = self.frontend_dist
        return path if path.is_absolute() else REPO_ROOT / path

    @property
    def ai_model_path(self) -> Path:
        path = self.ai_model_dir
        return path if path.is_absolute() else REPO_ROOT / path

    @property
    def recordings_path(self) -> Path:
        """Absolute folder for WAV files; a relative setting is resolved from the repo root."""
        path = self.recordings_dir
        return path if path.is_absolute() else REPO_ROOT / path


@lru_cache
def get_settings() -> Settings:
    return Settings()
