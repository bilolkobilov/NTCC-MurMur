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
        {"sub": str(user.id), "exp": datetime.now(UTC) + timedelta(minutes=5)},
        "an-attacker-guessed-secret-of-32-bytes",
        algorithm="HS256",
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

    assert response.status_code == 200
    assert client.post("/api/auth/login", json={"username": "dr.aziz", "password": DEFAULT_PASSWORD}).status_code == 401
    login(client, "dr.aziz", "brand-new-pass")


def test_password_change_kills_all_older_tokens(client, db):
    """A token stolen before the change (e.g. with a leaked password) must stop working at once."""
    make_user(db, "dr.aziz", Role.DOCTOR)
    stolen = login(client, "dr.aziz")
    own = login(client, "dr.aziz")

    response = client.post(
        "/api/auth/change-password",
        headers=own,
        json={"current_password": DEFAULT_PASSWORD, "new_password": "brand-new-pass"},
    )
    fresh = {"Authorization": f"Bearer {response.json()['access_token']}"}

    assert client.get("/api/auth/me", headers=stolen).status_code == 401
    assert client.get("/api/auth/me", headers=own).status_code == 401
    assert client.get("/api/auth/me", headers=fresh).status_code == 200
    assert client.get("/api/auth/me", headers=login(client, "dr.aziz", "brand-new-pass")).status_code == 200


def test_token_without_version_is_rejected(client, db):
    user = make_user(db, "dr.aziz", Role.DOCTOR)
    old_style = jwt.encode(
        {"sub": str(user.id), "exp": datetime.now(UTC) + timedelta(minutes=5)},
        get_settings().jwt_secret,
        algorithm="HS256",
    )

    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {old_style}"}).status_code == 401


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
    assert changed.status_code == 200
    assert changed.json()["must_change_password"] is False
    new_headers = {"Authorization": f"Bearer {changed.json()['access_token']}"}
    assert client.get("/api/auth/me", headers=new_headers).status_code == 200
    assert client.get("/api/auth/me", headers=headers).status_code == 401, "the temporary-password token is dead"


# --- brute-force protection ---


def wrong_login(client, username="dr.aziz"):
    return client.post("/api/auth/login", json={"username": username, "password": "wrong-password"})


def test_five_wrong_passwords_block_login_even_with_the_right_one(client, db):
    make_user(db, "dr.aziz", Role.DOCTOR)
    for _ in range(5):
        assert wrong_login(client).status_code == 401

    blocked = client.post("/api/auth/login", json={"username": "dr.aziz", "password": DEFAULT_PASSWORD})

    assert blocked.status_code == 429
    assert 1 <= int(blocked.headers["Retry-After"]) <= 15 * 60


def test_block_is_per_username(client, db):
    make_user(db, "dr.aziz", Role.DOCTOR)
    make_user(db, "dr.other", Role.DOCTOR)
    for _ in range(5):
        wrong_login(client, "dr.aziz")

    assert (
        client.post("/api/auth/login", json={"username": "dr.other", "password": DEFAULT_PASSWORD}).status_code == 200
    )
    assert (
        client.post("/api/auth/login", json={"username": "DR.AZIZ ", "password": DEFAULT_PASSWORD}).status_code == 429
    )


def test_block_ends_after_the_window(client, db):
    from app.services.login_limiter import get_login_limiter

    make_user(db, "dr.aziz", Role.DOCTOR)
    limiter = get_login_limiter()
    now = [1000.0]
    limiter.clock = lambda: now[0]
    try:
        for _ in range(5):
            wrong_login(client)
        assert login_status(client) == 429

        now[0] += 15 * 60  # the window has passed
        assert login_status(client) == 200
    finally:
        import time

        limiter.clock = time.monotonic


def login_status(client) -> int:
    return client.post("/api/auth/login", json={"username": "dr.aziz", "password": DEFAULT_PASSWORD}).status_code


def test_successful_login_resets_the_counter(client, db):
    make_user(db, "dr.aziz", Role.DOCTOR)
    for _ in range(4):
        wrong_login(client)
    assert login_status(client) == 200

    for _ in range(4):
        wrong_login(client)

    assert login_status(client) == 200


def test_unknown_username_costs_the_same_bcrypt_work(client, db, monkeypatch):
    from app.services import users

    make_user(db, "dr.aziz", Role.DOCTOR)
    calls: list[str] = []
    real_verify = users.verify_password
    monkeypatch.setattr(users, "verify_password", lambda pw, h: calls.append(h) or real_verify(pw, h))

    wrong_login(client, "dr.aziz")
    wrong_login(client, "nobody.here")

    assert len(calls) == 2, "a missing user must still run one bcrypt check"
    assert all(h.startswith("$2b$") for h in calls)


def test_limiter_memory_is_bounded():
    from app.services import login_limiter

    limiter = login_limiter.LoginLimiter(max_failures=5, window_seconds=60)
    for i in range(login_limiter.MAX_TRACKED_KEYS + 50):
        limiter.begin_attempt(("1.2.3.4", f"user{i}"))

    assert len(limiter._failures) <= login_limiter.MAX_TRACKED_KEYS


def test_parallel_attempts_cannot_slip_past_the_limit():
    """40 simultaneous wrong logins must not all be allowed before the first failure is counted."""
    import threading

    from app.services.login_limiter import LoginLimiter

    limiter = LoginLimiter(max_failures=5, window_seconds=900)
    barrier = threading.Barrier(40)
    allowed: list[bool] = []

    def attempt():
        barrier.wait()
        allowed.append(limiter.begin_attempt(("1.2.3.4", "dr.aziz")) is None)

    threads = [threading.Thread(target=attempt) for _ in range(40)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(10)

    assert allowed.count(True) == 5
