"""Test setup: all tests run against the separate `murmur_test` PostgreSQL database.

The env override below must happen before anything imports `app`, because the engine is created on import.
At session start the test database is wiped and rebuilt with the real Alembic migrations, so every run also tests
the migrations. After each test all tables are emptied.
"""

import os
import tempfile

os.environ["POSTGRES_DB"] = "murmur_test"
os.environ["RECORDINGS_DIR"] = tempfile.mkdtemp(prefix="murmur-test-recordings-")
os.environ["BCRYPT_ROUNDS"] = "4"  # fast hashing in tests; production uses the default 12
os.environ["AI_MODEL"] = "dummy"  # tests never depend on the downloaded model (tests/test_ai.py builds its own)

from pathlib import Path  # noqa: E402

import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402

from app.config import get_settings  # noqa: E402

BACKEND_DIR = Path(__file__).resolve().parents[1]


def alembic_config() -> Config:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    config.attributes["configure_logger"] = False
    return config


def _ensure_test_database() -> None:
    """Create `murmur_test` once if it does not exist (connects to the server's default `postgres` database)."""
    settings = get_settings()
    admin_engine = create_engine(settings.database_url.set(database="postgres"), isolation_level="AUTOCOMMIT")
    with admin_engine.connect() as conn:
        exists = conn.scalar(text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": settings.postgres_db})
        if not exists:
            conn.execute(text(f'CREATE DATABASE "{settings.postgres_db}"'))
    admin_engine.dispose()


def _reset_schema() -> None:
    from app.db import engine

    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))


@pytest.fixture(scope="session", autouse=True)
def test_database() -> None:
    assert get_settings().postgres_db == "murmur_test", "tests must never touch the main database"
    _ensure_test_database()
    _reset_schema()
    command.upgrade(alembic_config(), "head")


@pytest.fixture(autouse=True)
def clean_tables(test_database) -> None:
    yield
    from app.db import Base, engine

    names = ", ".join(f'"{table.name}"' for table in Base.metadata.sorted_tables)
    with engine.begin() as conn:
        conn.execute(text(f"TRUNCATE {names} RESTART IDENTITY CASCADE"))


@pytest.fixture(autouse=True)
def reset_login_limiter():
    """Wrong-password counters live in memory; never let one test's failures block another test."""
    from app.services.login_limiter import get_login_limiter

    limiter = get_login_limiter()
    limiter.reset()
    yield
    limiter.reset()


@pytest.fixture
def db():
    from app.db import SessionLocal

    with SessionLocal() as session:
        yield session


@pytest.fixture
def client() -> TestClient:
    from app.main import app

    with TestClient(app) as test_client:
        yield test_client
