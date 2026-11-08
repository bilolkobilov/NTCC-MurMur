"""Small builders shared by tests. They write straight to the database, so each test sets up only what it needs."""

from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.models import Device, Patient, Role, Sex, User
from app.security import generate_api_key, hash_api_key
from app.services.users import create_user

DEFAULT_PASSWORD = "correct-horse-1"


def make_user(
    db: Session,
    username: str,
    role: Role,
    *,
    password: str = DEFAULT_PASSWORD,
    is_active: bool = True,
    must_change_password: bool = False,
) -> User:
    user = create_user(
        db,
        username=username,
        password=password,
        role=role,
        full_name=username.title(),
        must_change_password=must_change_password,
    )
    user.is_active = is_active
    db.commit()
    return user


def login(client, username: str, password: str = DEFAULT_PASSWORD) -> dict[str, str]:
    """Log in and return the Authorization header."""
    response = client.post("/api/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def make_device(db: Session, serial: str, doctor: User | None = None) -> tuple[Device, str]:
    """Returns the device and its plain API key."""
    api_key = generate_api_key()
    device = Device(name=f"Device {serial}", serial=serial, api_key_hash=hash_api_key(api_key), doctor=doctor)
    db.add(device)
    db.commit()
    return device, api_key


def make_patient(db: Session, doctor: User, full_name: str = "Ali Valiyev", *, consent: bool = True) -> Patient:
    patient = Patient(
        doctor_id=doctor.id,
        full_name=full_name,
        birth_year=1990,
        sex=Sex.MALE,
        height_cm=175,
        weight_kg=70,
        consent_given_at=datetime.now(UTC) if consent else None,
    )
    db.add(patient)
    db.commit()
    return patient
