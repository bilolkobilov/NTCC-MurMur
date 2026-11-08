from datetime import UTC, datetime, timedelta

import jwt

from app.config import get_settings
from app.models import Role
from tests.helpers import DEFAULT_PASSWORD, login, make_user


def test_login_returns_token_and_role(client, db):
    make_user(db, "dr.aziz", Role.DOCTOR)

    response = client.post("/api/auth/login", json={"username": "dr.aziz", "password": DEFAULT_PASSWORD})

    assert response.status_code == 200
    body = response.json()
    assert body["role"] == "doctor"
    assert body["must_change_password"] is False
    assert body["access_token"]


def test_token_identifies_the_user(client, db):
    make_user(db, "dr.aziz", Role.DOCTOR)

    response = client.get("/api/auth/me", headers=login(client, "dr.aziz"))

    assert response.status_code == 200
    assert response.json()["username"] == "dr.aziz"
    assert "password_hash" not in response.json()


def test_password_is_stored_hashed(db):
    user = make_user(db, "dr.aziz", Role.DOCTOR)

    assert user.password_hash != DEFAULT_PASSWORD
    assert user.password_hash.startswith("$2b$")


def test_wrong_password_and_unknown_user_get_the_same_401(client, db):
    make_user(db, "dr.aziz", Role.DOCTOR)

    wrong_password = client.post("/api/auth/login", json={"username": "dr.aziz", "password": "nope-nope"})
    unknown_user = client.post("/api/auth/login", json={"username": "ghost", "password": "nope-nope"})

    assert wrong_password.status_code == unknown_user.status_code == 401
    assert wrong_password.json() == unknown_user.json()


def test_blocked_user_cannot_log_in(client, db):
    make_user(db, "dr.blocked", Role.DOCTOR, is_active=False)

    response = client.post("/api/auth/login", json={"username": "dr.blocked", "password": DEFAULT_PASSWORD})

    assert response.status_code == 403


def test_token_stops_working_when_user_is_blocked(client, db):
    user = make_user(db, "dr.aziz", Role.DOCTOR)
    headers = login(client, "dr.aziz")

    user.is_active = False
    db.commit()

    assert client.get("/api/auth/me", headers=headers).status_code == 401


def test_requests_without_valid_token_are_rejected(client, db):
    user = make_user(db, "dr.aziz", Role.DOCTOR)
    settings = get_settings()
    expired = jwt.encode(
        {"sub": str(user.id), "exp": datetime.now(UTC) - timedelta(minutes=1)}, settings.jwt_secret, algorithm="HS256"
    )
    forged = jwt.encode(
        {"sub": str(user.id), "exp": datetime.now(UTC) + timedelta(minutes=5)}, "an-attacker-guessed-secret-of-32-bytes", algorithm="HS256"
    )

    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/auth/me", headers={"Authorization": "Bearer garbage"}).status_code == 401
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {expired}"}).status_code == 401
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {forged}"}).status_code == 401


def test_change_password(client, db):
    make_user(db, "dr.aziz", Role.DOCTOR)
    headers = login(client, "dr.aziz")

    response = client.post(
        "/api/auth/change-password",
        headers=headers,
        json={"current_password": DEFAULT_PASSWORD, "new_password": "brand-new-pass"},
    )

    assert response.status_code == 204
    assert client.post("/api/auth/login", json={"username": "dr.aziz", "password": DEFAULT_PASSWORD}).status_code == 401
    login(client, "dr.aziz", "brand-new-pass")


def test_change_password_rejects_wrong_current_short_or_same_password(client, db):
    make_user(db, "dr.aziz", Role.DOCTOR)
    headers = login(client, "dr.aziz")

    def change(current: str, new: str) -> int:
        body = {"current_password": current, "new_password": new}
        return client.post("/api/auth/change-password", headers=headers, json=body).status_code

    assert change("wrong-current", "brand-new-pass") == 400
    assert change(DEFAULT_PASSWORD, "short") == 422
    assert change(DEFAULT_PASSWORD, "x" * 73) == 422
    assert change(DEFAULT_PASSWORD, DEFAULT_PASSWORD) == 400


def test_temporary_password_must_be_changed_before_anything_else(client, db):
    make_user(db, "ali", Role.PATIENT, must_change_password=True)

    login_response = client.post("/api/auth/login", json={"username": "ali", "password": DEFAULT_PASSWORD})
    assert login_response.json()["must_change_password"] is True
    headers = {"Authorization": f"Bearer {login_response.json()['access_token']}"}

    blocked = client.get("/api/auth/me", headers=headers)
    assert blocked.status_code == 403
    assert blocked.json()["detail"] == "password change required"

    changed = client.post(
        "/api/auth/change-password",
        headers=headers,
        json={"current_password": DEFAULT_PASSWORD, "new_password": "my-own-password"},
    )
    assert changed.status_code == 204
    assert client.get("/api/auth/me", headers=headers).status_code == 200
