"""The whole Stage 1 story through the public API only, in the order real people would do it.

admin creates doctor + device → doctor creates patient (with consent) and the patient's login → patient sets
own password → doctor starts an exam → device heartbeats, polls, records, uploads a WAV → dummy analysis →
doctor sees the AI result and reviews → patient sees the reviewed exam (without AI fields) → admin sees counts only.
"""

from tests.helpers import login, make_user, make_wav

from app.models import Role


def test_full_exam_flow(client, db):
    # --- admin: doctor and device ---
    make_user(db, "admin", Role.ADMIN)  # in real life: python -m app.cli create-admin
    admin = login(client, "admin")
    doctor_id = client.post(
        "/api/admin/doctors",
        headers=admin,
        json={"username": "dr.aziz", "password": "doctor-pass-1", "full_name": "Dr. Aziz Karimov"},
    ).json()["id"]
    created_device = client.post(
        "/api/admin/devices", headers=admin, json={"name": "MurMur #1", "serial": "MM-001", "doctor_id": doctor_id}
    ).json()
    device_key = {"X-Device-Key": created_device["api_key"]}

    # --- doctor: patient, consent, patient login ---
    doctor = login(client, "dr.aziz", "doctor-pass-1")
    patient_id = client.post(
        "/api/patients",
        headers=doctor,
        json={"full_name": "Ali Valiyev", "birth_year": 1990, "sex": "male", "height_cm": 175, "weight_kg": 70},
    ).json()["id"]
    assert client.post(f"/api/patients/{patient_id}/consent", headers=doctor).status_code == 200
    temp_password = client.post(
        f"/api/patients/{patient_id}/login", headers=doctor, json={"username": "ali.v"}
    ).json()["temporary_password"]

    # --- patient: first login forces a new password ---
    first_login = client.post("/api/auth/login", json={"username": "ali.v", "password": temp_password}).json()
    patient_temp = {"Authorization": f"Bearer {first_login['access_token']}"}
    assert first_login["must_change_password"] is True
    assert client.get("/api/me", headers=patient_temp).status_code == 403
    client.post(
        "/api/auth/change-password",
        headers=patient_temp,
        json={"current_password": temp_password, "new_password": "ali-own-password"},
    )
    patient = login(client, "ali.v", "ali-own-password")
    assert client.get("/api/me", headers=patient).json()["doctor_name"] == "Dr. Aziz Karimov"
    assert client.get("/api/me/exams", headers=patient).json() == []

    # --- doctor starts an exam ---
    exam = client.post(
        "/api/exams",
        headers=doctor,
        json={"patient_id": patient_id, "device_id": created_device["id"], "point": "MV"},
    ).json()
    assert exam["status"] == "waiting"

    # --- device: heartbeat, poll, upload ---
    assert client.post("/api/device/heartbeat", headers=device_key, json={"firmware_version": "0.1", "wifi_rssi": -55}).status_code == 200
    command = client.get("/api/device/command", headers=device_key).json()
    assert command == {"command": "record", "exam_id": exam["id"], "duration_s": 20}
    assert client.get(f"/api/exams/{exam['id']}", headers=doctor).json()["status"] == "recording"

    uploaded = client.post(
        f"/api/device/upload/{exam['id']}",
        headers=device_key,
        files={"audio": ("rec.wav", make_wav(seconds=3), "audio/wav")},
        data={"meta": '{"motion_detected": false, "sample_rate": 4000}'},
    )
    assert uploaded.status_code == 202

    # --- doctor: sees analysis result, listens, reviews ---
    analyzed = client.get(f"/api/exams/{exam['id']}", headers=doctor).json()
    assert analyzed["status"] == "analyzed"
    assert analyzed["recording"]["duration_s"] == 3.0
    assert analyzed["ai_result"]["model_name"] == "dummy"
    assert analyzed["ai_result"]["label"] == "not_analyzed"
    assert client.get(f"/api/exams/{exam['id']}/audio", headers=doctor).content[:4] == b"RIFF"

    assert client.get("/api/me/exams", headers=patient).json() == [], "patient must not see unreviewed exams"

    reviewed = client.patch(
        f"/api/exams/{exam['id']}/review",
        headers=doctor,
        json={"note": "Normal heart sounds. No follow-up needed.", "agrees_with_ai": False},
    ).json()
    assert reviewed["status"] == "reviewed"

    # --- patient: sees the reviewed exam with the note, but no AI data ---
    my_exams = client.get("/api/me/exams", headers=patient).json()
    assert len(my_exams) == 1
    assert my_exams[0]["id"] == exam["id"]
    assert my_exams[0]["doctor_note"] == "Normal heart sounds. No follow-up needed."
    for hidden in ("ai_result", "label", "model_name", "score", "doctor_agrees_with_ai", "quality"):
        assert hidden not in str(my_exams)

    # --- admin: counts and an audit trail, but no medical data ---
    stats = client.get("/api/admin/stats", headers=admin).json()
    assert stats["exams_by_status"]["reviewed"] == 1
    assert stats["patients_total"] == 1
    assert stats["devices_online"] == 1
    audit_log = client.get("/api/admin/audit", headers=admin).json()
    actions = {entry["action"] for entry in audit_log}
    assert {"exam.read", "exam.audio", "me.read", "me.exams.list"} <= actions
    admin_view = str(stats) + str(audit_log)
    assert "Ali Valiyev" not in admin_view
    assert "Normal heart sounds" not in admin_view
