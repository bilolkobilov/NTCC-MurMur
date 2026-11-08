"""Test setup: all tests run against the separate `murmur_test` PostgreSQL database.

The env override below must happen before anything imports `app`, because the engine is created on import.
"""

import os

os.environ["POSTGRES_DB"] = "murmur_test"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402

from app.config import get_settings  # noqa: E402


def _ensure_test_database() -> None:
    """Create `murmur_test` once if it does not exist (connects to the server's default `postgres` database)."""
    settings = get_settings()
    admin_url = settings.database_url.set(database="postgres")
    engine = create_engine(admin_url, isolation_level="AUTOCOMMIT")
    with engine.connect() as conn:
        exists = conn.scalar(text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": settings.postgres_db})
        if not exists:
            conn.execute(text(f'CREATE DATABASE "{settings.postgres_db}"'))
    engine.dispose()


@pytest.fixture(scope="session", autouse=True)
def test_database() -> None:
    assert get_settings().postgres_db == "murmur_test", "tests must never touch the main database"
    _ensure_test_database()


@pytest.fixture
def client() -> TestClient:
    from app.main import app

    with TestClient(app) as test_client:
        yield test_client
