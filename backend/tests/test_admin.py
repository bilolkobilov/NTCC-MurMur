from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.models import AuditLog, Device, Exam, ExamStatus, Patient, Role, Sex
from app.security import hash_api_key
from tests.helpers import DEFAULT_PASSWORD, login, make_user


@pytest.fixture
def admin(client, db):
    make_user(db, "admin", Role.ADMIN)
    return login(client, "admin")


def create_doctor(client, admin, username="dr.aziz"):
    response = client.post(
        "/api/admin/doctors",
        headers=admin,
        json={"username": username, "password": "doctor-pass-1", "full_name": "Aziz Karimov"},
    )
    assert response.status_code == 201, response.text
    return response.json()


# --- doctors ---


def test_admin_creates_doctor_who_can_log_in_without_forced_change(client, admin):
    doctor = create_doctor(client, admin)

    assert doctor["username"] == "dr.aziz"
    assert doctor["is_active"] is True
    assert "password" not in doctor and "password_hash" not in doctor
    response = client.post("/api/auth/login", json={"username": "dr.aziz", "password": "doctor-pass-1"})
    assert response.status_code == 200
    assert response.json()["must_change_password"] is False


def test_duplicate_username_is_rejected(client, admin):
    create_doctor(client, admin)

    response = client.post(
        "/api/admin/doctors",
        headers=admin,
        json={"username": "dr.aziz", "password": "another-pass", "full_name": "Other"},
    )

    assert response.status_code == 409


def test_bad_doctor_input_is_rejected(client, admin):
    short_password = {"username": "dr.x", "password": "short", "full_name": "X"}
    bad_username = {"username": "dr aziz!", "password": "doctor-pass-1", "full_name": "X"}

    assert client.post("/api/admin/doctors", headers=admin, json=short_password).status_code == 422
    assert client.post("/api/admin/doctors", headers=admin, json=bad_username).status_code == 422


def test_list_doctors_shows_patient_count_only(client, admin, db):
    doctor = create_doctor(client, admin)
    db.add(Patient(doctor_id=doctor["id"], full_name="Secret Name", birth_year=1990, sex=Sex.MALE))
    db.commit()

    doctors = client.get("/api/admin/doctors", headers=admin).json()

    assert [(d["username"], d["patient_count"]) for d in doctors] == [("dr.aziz", 1)]
    assert "Secret Name" not in str(doctors)


def test_block_and_unblock_doctor(client, admin):
    doctor = create_doctor(client, admin)
    doctor_headers = login(client, "dr.aziz", "doctor-pass-1")

    blocked = client.post(f"/api/admin/doctors/{doctor['id']}/block", headers=admin)
    assert blocked.status_code == 200 and blocked.json()["is_active"] is False
    assert client.post("/api/auth/login", json={"username": "dr.aziz", "password": "doctor-pass-1"}).status_code == 403
    assert client.get("/api/auth/me", headers=doctor_headers).status_code == 401

    unblocked = client.post(f"/api/admin/doctors/{doctor['id']}/unblock", headers=admin)
    assert unblocked.json()["is_active"] is True
    assert client.get("/api/auth/me", headers=doctor_headers).status_code == 200


def test_block_only_works_on_doctors(client, admin, db):
    other_admin = make_user(db, "admin2", Role.ADMIN)

    assert client.post(f"/api/admin/doctors/{other_admin.id}/block", headers=admin).status_code == 404
    assert client.post("/api/admin/doctors/9999/block", headers=admin).status_code == 404


# --- devices ---


def test_create_device_shows_key_once_and_stores_only_its_hash(client, admin, db):
    response = client.post("/api/admin/devices", headers=admin, json={"name": "MurMur #1", "serial": "MM-001"})

    assert response.status_code == 201
    api_key = response.json()["api_key"]
    assert len(api_key) >= 40
    device = db.scalar(select(Device).where(Device.serial == "MM-001"))
    assert device.api_key_hash == hash_api_key(api_key)
    assert api_key not in device.api_key_hash
    listed = client.get("/api/admin/devices", headers=admin).json()
    assert "api_key" not in listed[0]
    assert api_key not in str(listed)


def test_duplicate_serial_is_rejected(client, admin):
    client.post("/api/admin/devices", headers=admin, json={"name": "A", "serial": "MM-001"})

    response = client.post("/api/admin/devices", headers=admin, json={"name": "B", "serial": "MM-001"})

    assert response.status_code == 409


def test_assign_and_unassign_device(client, admin):
    doctor = create_doctor(client, admin)
    device = client.post("/api/admin/devices", headers=admin, json={"name": "A", "serial": "MM-001"}).json()

    assigned = client.patch(f"/api/admin/devices/{device['id']}", headers=admin, json={"doctor_id": doctor["id"]})
    assert assigned.status_code == 200 and assigned.json()["doctor_id"] == doctor["id"]

    unassigned = client.patch(f"/api/admin/devices/{device['id']}", headers=admin, json={"doctor_id": None})
    assert unassigned.json()["doctor_id"] is None


def test_device_can_only_be_assigned_to_an_active_doctor(client, admin, db):
    device = client.post("/api/admin/devices", headers=admin, json={"name": "A", "serial": "MM-001"}).json()
    patient_user = make_user(db, "ali", Role.PATIENT)
    blocked = make_user(db, "dr.old", Role.DOCTOR, is_active=False)

    def assign(doctor_id):
        return client.patch(f"/api/admin/devices/{device['id']}", headers=admin, json={"doctor_id": doctor_id})

    assert assign(patient_user.id).status_code == 400
    assert assign(blocked.id).status_code == 400
    assert assign(9999).status_code == 400
    assert client.patch("/api/admin/devices/9999", headers=admin, json={"doctor_id": None}).status_code == 404


def test_device_online_means_seen_in_last_30_seconds(client, admin, db):
    now = datetime.now(UTC)
    db.add_all(
        [
            Device(name="fresh", serial="S1", api_key_hash="a" * 64, last_seen_at=now - timedelta(seconds=10)),
            Device(name="stale", serial="S2", api_key_hash="b" * 64, last_seen_at=now - timedelta(seconds=60)),
            Device(name="never", serial="S3", api_key_hash="c" * 64),
        ]
    )
    db.commit()

    online = {d["name"]: d["online"] for d in client.get("/api/admin/devices", headers=admin).json()}

    assert online == {"fresh": True, "stale": False, "never": False}


# --- stats and audit ---


def test_stats_are_counts(client, admin, db):
    doctor = make_user(db, "dr.aziz", Role.DOCTOR)
    make_user(db, "dr.old", Role.DOCTOR, is_active=False)
    patient = Patient(doctor_id=doctor.id, full_name="P", birth_year=2000, sex=Sex.FEMALE)
    device = Device(name="d", serial="S1", api_key_hash="a" * 64, last_seen_at=datetime.now(UTC))
    db.add_all([patient, device])
    db.flush()
    db.add_all(
        [
            Exam(patient_id=patient.id, doctor_id=doctor.id, device_id=device.id, point="MV"),
            Exam(patient_id=patient.id, doctor_id=doctor.id, device_id=device.id, point="AV", status=ExamStatus.FAILED),
        ]
    )
    db.commit()

    stats = client.get("/api/admin/stats", headers=admin).json()

    assert stats["doctors_total"] == 2
    assert stats["doctors_active"] == 1
    assert stats["patients_total"] == 1
    assert stats["devices_total"] == 1
    assert stats["devices_online"] == 1
    assert stats["exams_today"] == 2
    assert stats["exams_by_status"]["waiting"] == 1
    assert stats["exams_by_status"]["failed"] == 1
    assert stats["exams_by_status"]["reviewed"] == 0
    assert stats["analyzer"] == {"name": "dummy", "version": "0.1.0"}


def test_audit_log_lists_newest_first_with_ids_only(client, admin, db):
    doctor = make_user(db, "dr.aziz", Role.DOCTOR)
    db.add_all(
        [
            AuditLog(user_id=doctor.id, action="patient.read", object_type="patient", object_id=7),
            AuditLog(user_id=doctor.id, action="exam.read", object_type="exam", object_id=3),
        ]
    )
    db.commit()

    entries = client.get("/api/admin/audit", headers=admin).json()

    assert [(e["action"], e["object_id"], e["username"], e["role"]) for e in entries] == [
        ("exam.read", 3, "dr.aziz", "doctor"),
        ("patient.read", 7, "dr.aziz", "doctor"),
    ]
    assert len(client.get("/api/admin/audit?limit=1", headers=admin).json()) == 1


def test_audit_log_filters_by_action_prefix(client, admin, db):
    doctor = make_user(db, "dr.aziz", Role.DOCTOR)
    for action in ("patient.read", "patient.exams.list", "exam.read", "examination.x", "me.read"):
        db.add(AuditLog(user_id=doctor.id, action=action, object_type="x", object_id=1))
    db.commit()

    def actions(query):
        return sorted(e["action"] for e in client.get(f"/api/admin/audit?{query}", headers=admin).json())

    assert actions("action=patient") == ["patient.exams.list", "patient.read"]
    assert actions("action=exam") == ["exam.read"]  # a prefix stops at the dot: not "examination.x"
    assert actions("action=patient.read") == ["patient.read"]
    assert client.get("/api/admin/audit?action=%25", headers=admin).status_code == 422  # no LIKE wildcards


# --- access ---

ADMIN_ENDPOINTS = [
    ("get", "/api/admin/doctors"),
    ("post", "/api/admin/doctors"),
    ("post", "/api/admin/doctors/1/block"),
    ("post", "/api/admin/doctors/1/unblock"),
    ("get", "/api/admin/devices"),
    ("post", "/api/admin/devices"),
    ("patch", "/api/admin/devices/1"),
    ("get", "/api/admin/stats"),
    ("get", "/api/admin/audit"),
    ("post", "/api/admin/doctors/1/password"),
    ("post", "/api/admin/devices/1/rotate-key"),
    ("get", "/api/admin/devices/1"),
    ("post", "/api/admin/devices/1/disconnect"),
    ("post", "/api/admin/devices/1/reconnect"),
    ("post", "/api/admin/devices/1/self-test"),
    ("get", "/api/admin/devices/1/activity"),
]


@pytest.mark.parametrize(("method", "path"), ADMIN_ENDPOINTS)
@pytest.mark.parametrize("role", [Role.DOCTOR, Role.PATIENT])
def test_only_admin_can_use_admin_endpoints(client, db, method, path, role):
    make_user(db, "someone", role)
    headers = login(client, "someone", DEFAULT_PASSWORD)

    assert client.request(method, path, headers=headers, json={}).status_code == 403
    assert client.request(method, path, json={}).status_code == 401


def test_admin_resets_a_doctors_forgotten_password(client, admin):
    doctor = create_doctor(client, admin)
    old_session = login(client, "dr.aziz", "doctor-pass-1")

    response = client.post(
        f"/api/admin/doctors/{doctor['id']}/password", headers=admin, json={"password": "new-pass-99"}
    )

    assert response.status_code == 200
    assert client.get("/api/auth/me", headers=old_session).status_code == 401, "old sessions end"
    assert client.post("/api/auth/login", json={"username": "dr.aziz", "password": "doctor-pass-1"}).status_code == 401
    new_login = client.post("/api/auth/login", json={"username": "dr.aziz", "password": "new-pass-99"})
    assert new_login.status_code == 200
    assert new_login.json()["must_change_password"] is False


def test_password_reset_only_for_doctors_and_with_a_valid_password(client, admin, db):
    doctor = create_doctor(client, admin)
    other_admin = make_user(db, "admin2", Role.ADMIN)

    def reset(user_id, password="new-pass-99"):
        return client.post(f"/api/admin/doctors/{user_id}/password", headers=admin, json={"password": password})

    assert reset(other_admin.id).status_code == 404
    assert reset(9999).status_code == 404
    assert reset(doctor["id"], "short").status_code == 422


def test_rotate_device_key(client, admin, db):
    created = client.post("/api/admin/devices", headers=admin, json={"name": "A", "serial": "MM-001"}).json()
    old_key = {"X-Device-Key": created["api_key"]}
    assert client.post("/api/device/heartbeat", headers=old_key, json={}).status_code == 200

    rotated = client.post(f"/api/admin/devices/{created['id']}/rotate-key", headers=admin)

    assert rotated.status_code == 200
    new_key = {"X-Device-Key": rotated.json()["api_key"]}
    assert rotated.json()["api_key"] != created["api_key"]
    assert client.post("/api/device/heartbeat", headers=old_key, json={}).status_code == 401
    assert client.post("/api/device/heartbeat", headers=new_key, json={}).status_code == 200
    assert rotated.json()["api_key"] not in client.get("/api/admin/devices", headers=admin).text
    assert client.post("/api/admin/devices/9999/rotate-key", headers=admin).status_code == 404


def test_admin_deletes_a_device_without_exams(client, admin, db):
    device = client.post("/api/admin/devices", headers=admin, json={"name": "A", "serial": "MM-001"}).json()

    assert client.delete(f"/api/admin/devices/{device['id']}", headers=admin).status_code == 204

    assert client.get(f"/api/admin/devices/{device['id']}", headers=admin).status_code == 404
    assert client.get("/api/admin/devices", headers=admin).json() == []
    assert db.scalar(select(AuditLog).where(AuditLog.action == "device.delete")) is not None
    assert client.delete(f"/api/admin/devices/{device['id']}", headers=admin).status_code == 404


def test_device_with_exams_cannot_be_deleted(client, admin, db):
    doctor = create_doctor(client, admin)
    device = client.post(
        "/api/admin/devices", headers=admin, json={"name": "A", "serial": "MM-001", "doctor_id": doctor["id"]}
    ).json()
    patient = Patient(
        doctor_id=doctor["id"],
        full_name="P",
        birth_date=datetime(1990, 1, 1).date(),
        sex=Sex.MALE,
        consent_given_at=datetime.now(UTC),
    )
    db.add(patient)
    db.flush()
    db.add(Exam(patient_id=patient.id, device_id=device["id"], doctor_id=doctor["id"], point="MV"))
    db.commit()

    assert client.delete(f"/api/admin/devices/{device['id']}", headers=admin).status_code == 409
    assert client.get(f"/api/admin/devices/{device['id']}", headers=admin).status_code == 200


def test_only_admin_deletes_devices(client, admin, db):
    device = client.post("/api/admin/devices", headers=admin, json={"name": "A", "serial": "MM-001"}).json()
    make_user(db, "dr.x", Role.DOCTOR)
    assert client.delete(f"/api/admin/devices/{device['id']}", headers=login(client, "dr.x")).status_code == 403
    assert client.delete(f"/api/admin/devices/{device['id']}").status_code == 401


# --- where a doctor works (clinic) ---


def test_clinic_is_set_on_create_listed_edited_and_cleared(client, admin):
    created = client.post(
        "/api/admin/doctors",
        headers=admin,
        json={
            "username": "dr.clinic",
            "password": "doctor-pass-1",
            "full_name": "A B",
            "clinic": "  Highlands Clinic ",
        },
    ).json()
    assert created["clinic"] == "Highlands Clinic"
    assert [d["clinic"] for d in client.get("/api/admin/doctors", headers=admin).json()] == ["Highlands Clinic"]

    moved = client.patch(f"/api/admin/doctors/{created['id']}", headers=admin, json={"clinic": "Lakeside Center"})
    assert moved.json()["clinic"] == "Lakeside Center"
    cleared = client.patch(f"/api/admin/doctors/{created['id']}", headers=admin, json={"clinic": "  "})
    assert cleared.json()["clinic"] is None


def test_clinic_is_optional_and_limited(client, admin):
    assert create_doctor(client, admin)["clinic"] is None
    too_long = {"username": "dr.long", "password": "doctor-pass-1", "full_name": "A B", "clinic": "x" * 201}
    assert client.post("/api/admin/doctors", headers=admin, json=too_long).status_code == 422


def test_only_admin_edits_a_clinic_and_only_on_doctors(client, db, admin):
    doctor = create_doctor(client, admin)
    make_user(db, "dr.other", Role.DOCTOR)
    patient = make_user(db, "pat.ient", Role.PATIENT)
    other = login(client, "dr.other")

    assert client.patch(f"/api/admin/doctors/{doctor['id']}", json={"clinic": "X"}).status_code == 401
    assert client.patch(f"/api/admin/doctors/{doctor['id']}", headers=other, json={"clinic": "X"}).status_code == 403
    assert client.patch(f"/api/admin/doctors/{patient.id}", headers=admin, json={"clinic": "X"}).status_code == 404
