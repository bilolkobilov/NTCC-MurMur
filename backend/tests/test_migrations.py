"""The Alembic migrations create exactly the tables our models describe, and can be rolled back."""

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError

import app.models  # noqa: F401
from app.db import Base, engine
from tests.conftest import alembic_config

EXPECTED_TABLES = {
    "users",
    "devices",
    "patients",
    "exams",
    "recordings",
    "ai_results",
    "device_commands",
    "audit_logs",
    "vital_signs",
    "ecg_recordings",
    "ecg_results",
}


def _tables() -> set[str]:
    return set(inspect(engine).get_table_names()) - {"alembic_version"}


def test_upgrade_creates_all_tables():
    assert _tables() == EXPECTED_TABLES


def test_models_and_migrations_match():
    with engine.connect() as conn:
        diff = compare_metadata(MigrationContext.configure(conn), Base.metadata)

    assert diff == [], f"models changed without a migration: {diff}"


def test_downgrade_to_base_and_back():
    config = alembic_config()

    command.downgrade(config, "base")
    assert _tables() == set()

    command.upgrade(config, "head")
    assert _tables() == EXPECTED_TABLES


def test_database_rejects_unknown_role(db):
    with pytest.raises(IntegrityError):
        db.execute(
            text(
                "INSERT INTO users (username, password_hash, role, full_name, is_active, must_change_password) "
                "VALUES ('x', 'x', 'boss', 'X', true, false)"
            )
        )
    db.rollback()
