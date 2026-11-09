import pytest
from sqlalchemy import func, select

from app import cli
from app.config import get_settings
from app.models import Device, Role, User
from app.security import hash_api_key, verify_password


@pytest.fixture
def admin_env(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "first_admin_username", "root.admin")
    monkeypatch.setattr(settings, "first_admin_password", "first-admin-pass")
    return settings


def test_create_admin_from_env(admin_env, db):
    assert cli.main(["create-admin"]) == 0

    admin = db.scalar(select(User).where(User.username == "root.admin"))
    assert admin.role == Role.ADMIN
    assert admin.is_active
    assert verify_password("first-admin-pass", admin.password_hash)


def test_create_admin_twice_does_not_duplicate_or_change_password(admin_env, db, monkeypatch):
    assert cli.main(["create-admin"]) == 0
    monkeypatch.setattr(admin_env, "first_admin_password", "another-password")

    assert cli.main(["create-admin"]) == 0

    admins = db.scalars(select(User).where(User.username == "root.admin")).all()
    assert len(admins) == 1
    assert verify_password("first-admin-pass", admins[0].password_hash)


def test_create_admin_fails_without_password(admin_env, db, monkeypatch):
    monkeypatch.setattr(admin_env, "first_admin_password", None)

    assert cli.main(["create-admin"]) == 1
    assert db.scalar(select(func.count()).select_from(User)) == 0


def test_admin_created_by_cli_can_log_in(admin_env, client):
    cli.main(["create-admin"])

    response = client.post("/api/auth/login", json={"username": "root.admin", "password": "first-admin-pass"})

    assert response.status_code == 200
    assert response.json()["role"] == "admin"


def test_seed_demo_creates_doctor_and_device_with_known_key(db, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "demo_device_key", "demo-key-for-test")

    assert cli.main(["seed-demo"]) == 0
    assert cli.main(["seed-demo"]) == 0  # second run changes nothing

    doctor = db.scalar(select(User).where(User.username == "doctor"))
    assert doctor.role == Role.DOCTOR
    device = db.scalar(select(Device))
    assert device.doctor_id == doctor.id
    assert device.api_key_hash == hash_api_key("demo-key-for-test")
    assert db.scalar(select(func.count()).select_from(Device)) == 1


def test_seed_demo_skipped_without_key(db, monkeypatch):
    monkeypatch.setattr(get_settings(), "demo_device_key", None)

    assert cli.main(["seed-demo"]) == 0
    assert db.scalar(select(func.count()).select_from(User)) == 0
