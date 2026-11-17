"""Device health rules (pure) and the admin device screens' API: telemetry, disconnect, self-test, activity."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.models import AuditLog, CommandStatus, Device, DeviceCommand, Exam, ExamStatus, Role, User
from app.services import device_health
from tests.helpers import login, make_device, make_patient, make_user


def device(**fields) -> Device:
    return Device(name="d", serial="S", api_key_hash="a" * 64, **fields)


def seen(**fields) -> Device:
    return device(last_seen_at=datetime.now(UTC), **fields)


# --- pure rules ---


def test_never_seen_device_is_pending():
    assert device_health.state(device()) == "pending"
    assert device_health.health(device()) == "pending"


def test_healthy_when_every_known_value_is_fine():
    d = seen(battery_pct=80, wifi_rssi=-55, mic_noise_db=24, last_self_test_ok=True)
    assert device_health.state(d) == "online"
    assert device_health.health(d) == "healthy"


@pytest.mark.parametrize(
    ("fields", "expected"),
    [
        ({"battery_pct": 29}, "attention"),
        ({"battery_pct": 14}, "fault"),
        ({"wifi_rssi": -73}, "attention"),
        ({"wifi_rssi": -72}, "attention"),
        ({"wifi_rssi": -60}, "healthy"),
        ({"mic_noise_db": 36}, "degraded"),
        ({"mic_noise_db": 35}, "healthy"),
        ({"last_self_test_ok": False}, "fault"),
    ],
)
def test_health_thresholds(fields, expected):
    assert device_health.health(seen(**fields)) == expected


def test_offline_device_is_a_fault():
    d = device(last_seen_at=datetime.now(UTC) - timedelta(minutes=5))
    assert device_health.state(d) == "offline"
    assert device_health.health(d) == "fault"


def test_disconnected_wins_over_online():
    assert device_health.state(seen(disconnected_at=datetime.now(UTC))) == "disconnected"


def test_firmware_is_checked_only_when_a_latest_version_is_configured(monkeypatch):
    d = seen(firmware_version="0.1")
    assert device_health.checks(d)["firmware"] == "nodata"
    monkeypatch.setenv("LATEST_FIRMWARE", "0.2")
    from app.config import get_settings

    get_settings.cache_clear()
    try:
        assert device_health.checks(d)["firmware"] == "warn"
        assert device_health.checks(seen(firmware_version="0.2"))["firmware"] == "pass"
    finally:
        get_settings.cache_clear()


# --- API ---


@pytest.fixture
def admin(client, db):
    make_user(db, "admin", Role.ADMIN)
    return login(client, "admin")


def register(client, admin, **extra):
    body = {"serial": "SN-5516-0042", **extra}
    response = client.post("/api/admin/devices", headers=admin, json=body)
    assert response.status_code == 201, response.text
    return response.json()


def test_register_without_a_name_uses_the_device_code_and_keeps_model_and_location(client, admin):
    created = register(client, admin, model="MurMur S3", location="Ward 2")

    assert created["code"] == f"MM-{created['id']:04d}"
    assert created["name"] == created["code"]
    assert (created["model"], created["location"]) == ("MurMur S3", "Ward 2")
    assert created["state"] == "pending" and created["health"] == "pending"
    assert created["api_key"]


def test_list_shows_the_doctors_clinic(client, admin, db):
    doctor = make_user(db, "dr.aziz", Role.DOCTOR)
    doctor.clinic = "Lakeside Center"
    db.commit()
    register(client, admin, doctor_id=doctor.id)

    listed = client.get("/api/admin/devices", headers=admin).json()

    assert listed[0]["clinic"] == "Lakeside Center"
    assert listed[0]["doctor_name"] == doctor.full_name


def test_heartbeat_stores_telemetry_and_keeps_values_it_omits(client, db):
    dev, key = make_device(db, "MM-001")
    headers = {"X-Device-Key": key}

    first = {"battery_pct": 71, "mic_noise_db": 26, "wifi_ssid": "Clinic", "ip": "10.0.0.5", "mac": "AA:BB:CC:DD:EE:FF"}
    assert client.post("/api/device/heartbeat", headers=headers, json=first).status_code == 200
    assert client.post("/api/device/heartbeat", headers=headers, json={"wifi_rssi": -50}).status_code == 200

    db.refresh(dev)
    assert (dev.battery_pct, dev.mic_noise_db, dev.wifi_ssid, dev.ip) == (71, 26, "Clinic", "10.0.0.5")
    assert dev.wifi_rssi == -50


@pytest.mark.parametrize("body", [{"battery_pct": 101}, {"battery_pct": -1}, {"mic_noise_db": 500}])
def test_heartbeat_rejects_impossible_values(client, db, body):
    _, key = make_device(db, "MM-001")
    assert client.post("/api/device/heartbeat", headers={"X-Device-Key": key}, json=body).status_code == 422


def test_disconnect_blocks_the_device_and_reconnect_restores_it(client, admin, db):
    dev, key = make_device(db, "MM-001")
    headers = {"X-Device-Key": key}

    done = client.post(f"/api/admin/devices/{dev.id}/disconnect", headers=admin, json={"reason": "maintenance"})
    assert done.status_code == 200 and done.json()["state"] == "disconnected"
    assert done.json()["disconnect_reason"] == "maintenance"
    assert client.post("/api/device/heartbeat", headers=headers, json={}).status_code == 403
    assert client.get("/api/device/command", headers=headers).status_code == 403
    assert (
        client.post(f"/api/admin/devices/{dev.id}/disconnect", headers=admin, json={"reason": "lost"}).status_code
        == 409
    )

    back = client.post(f"/api/admin/devices/{dev.id}/reconnect", headers=admin)
    assert back.status_code == 200 and back.json()["disconnected_at"] is None
    assert client.post("/api/device/heartbeat", headers=headers, json={}).status_code == 200
    assert client.post(f"/api/admin/devices/{dev.id}/reconnect", headers=admin).status_code == 409


def test_disconnect_needs_a_known_reason(client, admin, db):
    dev, _ = make_device(db, "MM-001")
    assert (
        client.post(f"/api/admin/devices/{dev.id}/disconnect", headers=admin, json={"reason": "bored"}).status_code
        == 422
    )
    assert client.post(f"/api/admin/devices/{dev.id}/disconnect", headers=admin, json={}).status_code == 422


def test_disconnected_device_is_hidden_from_the_doctor_and_cannot_start_exams(client, admin, db):
    doctor = make_user(db, "dr.aziz", Role.DOCTOR)
    dev, _ = make_device(db, "MM-001", doctor)
    patient = make_patient(db, doctor)
    client.post(f"/api/admin/devices/{dev.id}/disconnect", headers=admin, json={"reason": "maintenance"})
    mine = login(client, "dr.aziz")

    assert client.get("/api/devices", headers=mine).json() == []
    started = client.post(
        "/api/exams", headers=mine, json={"patient_id": patient.id, "device_id": dev.id, "point": "MV"}
    )
    assert started.status_code == 400


def test_cannot_disconnect_a_device_that_is_recording(client, admin, db):
    doctor = make_user(db, "dr.aziz", Role.DOCTOR)
    dev, key = make_device(db, "MM-001", doctor)
    patient = make_patient(db, doctor)
    mine = login(client, "dr.aziz")
    client.post("/api/exams", headers=mine, json={"patient_id": patient.id, "device_id": dev.id, "point": "MV"})
    client.get("/api/device/command", headers={"X-Device-Key": key})  # exam moves to recording

    assert client.get(f"/api/admin/devices/{dev.id}", headers=admin).json()["busy"] is True
    response = client.post(f"/api/admin/devices/{dev.id}/disconnect", headers=admin, json={"reason": "lost"})
    assert response.status_code == 409


def test_self_test_round_trip(client, admin, db):
    dev, key = make_device(db, "MM-001")
    headers = {"X-Device-Key": key}
    offline = client.post(f"/api/admin/devices/{dev.id}/self-test", headers=admin)
    assert offline.status_code == 409  # never seen = not online

    client.post("/api/device/heartbeat", headers=headers, json={})
    assert client.post(f"/api/admin/devices/{dev.id}/self-test", headers=admin).status_code == 202
    assert client.post(f"/api/admin/devices/{dev.id}/self-test", headers=admin).status_code == 202  # not queued twice
    assert len(db.scalars(select(DeviceCommand).where(DeviceCommand.command == "self_test")).all()) == 1

    command = client.get("/api/device/command", headers=headers).json()
    assert command == {"command": "self_test", "exam_id": None, "duration_s": 0}
    assert client.get("/api/device/command", headers=headers).status_code == 204  # handed out once

    assert (
        client.post("/api/device/self-test", headers=headers, json={"ok": True, "mic_noise_db": 22}).status_code == 200
    )
    shown = client.get(f"/api/admin/devices/{dev.id}", headers=admin).json()
    assert shown["last_self_test_ok"] is True and shown["mic_noise_db"] == 22
    assert shown["checks"]["self_test"] == "pass"
    db.expire_all()
    assert db.scalar(select(DeviceCommand.status)) == CommandStatus.DONE


def test_admin_actions_are_in_the_device_activity_and_the_audit_log(client, admin, db):
    created = register(client, admin)
    client.post(f"/api/admin/devices/{created['id']}/disconnect", headers=admin, json={"reason": "security"})
    client.post(f"/api/admin/devices/{created['id']}/reconnect", headers=admin)
    client.post(f"/api/admin/devices/{created['id']}/rotate-key", headers=admin)

    activity = client.get(f"/api/admin/devices/{created['id']}/activity", headers=admin).json()

    assert [e["action"] for e in activity] == [
        "device.rotate_key",
        "device.reconnect",
        "device.disconnect.security",
        "device.create",
    ]
    assert {e["username"] for e in activity} == {"admin"}
    assert db.scalar(select(AuditLog.id).where(AuditLog.action == "device.disconnect.security")) is not None


def test_device_detail_is_404_for_an_unknown_device(client, admin):
    assert client.get("/api/admin/devices/9999", headers=admin).status_code == 404
    assert client.get("/api/admin/devices/9999/activity", headers=admin).status_code == 404


@pytest.mark.parametrize("reason", ["lost", "security"])
def test_a_lost_or_compromised_key_never_works_again(client, admin, db, reason):
    dev, old_key = make_device(db, "MM-001")
    client.post(f"/api/admin/devices/{dev.id}/disconnect", headers=admin, json={"reason": reason})
    client.post(f"/api/admin/devices/{dev.id}/reconnect", headers=admin)

    assert client.post("/api/device/heartbeat", headers={"X-Device-Key": old_key}, json={}).status_code == 401
    new_key = client.post(f"/api/admin/devices/{dev.id}/rotate-key", headers=admin).json()["api_key"]
    assert client.post("/api/device/heartbeat", headers={"X-Device-Key": new_key}, json={}).status_code == 200


def start_exam(client, db, dev):
    doctor = db.get(User, dev.doctor_id)
    patient = make_patient(db, doctor)
    mine = login(client, doctor.username)
    started = client.post(
        "/api/exams", headers=mine, json={"patient_id": patient.id, "device_id": dev.id, "point": "MV"}
    )
    assert started.status_code == 201, started.text
    return started.json()["id"]


def test_disconnect_fails_the_waiting_exams_so_they_are_never_recorded_later(client, admin, db):
    dev, key = make_device(db, "MM-001", make_user(db, "dr.aziz", Role.DOCTOR))
    exam_id = start_exam(client, db, dev)

    client.post(f"/api/admin/devices/{dev.id}/disconnect", headers=admin, json={"reason": "maintenance"})
    client.post(f"/api/admin/devices/{dev.id}/reconnect", headers=admin)

    assert client.get("/api/device/command", headers={"X-Device-Key": key}).status_code == 204  # nothing stale
    exam = db.get(Exam, exam_id, populate_existing=True)
    assert exam.status == ExamStatus.FAILED and "disconnected" in exam.failure_reason


def test_giving_the_device_to_another_doctor_fails_the_old_doctors_waiting_exams(client, admin, db):
    dev, key = make_device(db, "MM-001", make_user(db, "dr.aziz", Role.DOCTOR))
    other = make_user(db, "dr.bek", Role.DOCTOR)
    exam_id = start_exam(client, db, dev)

    moved = client.patch(f"/api/admin/devices/{dev.id}", headers=admin, json={"doctor_id": other.id})

    assert moved.status_code == 200, moved.text
    assert client.get("/api/device/command", headers={"X-Device-Key": key}).status_code == 204
    assert db.get(Exam, exam_id, populate_existing=True).status == ExamStatus.FAILED


def test_device_cannot_change_doctor_while_recording(client, admin, db):
    dev, key = make_device(db, "MM-001", make_user(db, "dr.aziz", Role.DOCTOR))
    other = make_user(db, "dr.bek", Role.DOCTOR)
    start_exam(client, db, dev)
    client.get("/api/device/command", headers={"X-Device-Key": key})  # now recording

    assert client.patch(f"/api/admin/devices/{dev.id}", headers=admin, json={"doctor_id": other.id}).status_code == 409


def test_a_self_test_that_was_taken_but_never_reported_does_not_block_new_ones(client, admin, db):
    dev, key = make_device(db, "MM-001")
    headers = {"X-Device-Key": key}
    client.post("/api/device/heartbeat", headers=headers, json={})
    client.post(f"/api/admin/devices/{dev.id}/self-test", headers=admin)
    client.get("/api/device/command", headers=headers)  # taken, then the device reboots and never reports
    stuck = db.scalar(select(DeviceCommand))
    stuck.taken_at = datetime.now(UTC) - timedelta(minutes=5)
    db.commit()

    assert client.post(f"/api/admin/devices/{dev.id}/self-test", headers=admin).status_code == 202
    assert client.get("/api/device/command", headers=headers).json()["command"] == "self_test"
