"""Access rules from AGENTS.md that cut across roles. Role-only checks (403/401 per endpoint) live in
test_admin.py, test_doctor.py and test_device.py; here are the rules about WHOSE data and WHICH data."""

from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from app.models import AIResult, AuditLog, Exam, ExamStatus, Role
from tests.helpers import login, make_device, make_patient, make_user


def patient_with_login(db, doctor, username, full_name):
    patient = make_patient(db, doctor, full_name)
    user = make_user(db, username, Role.PATIENT)
    patient.user_id = user.id
    db.commit()
    return patient


def add_exam(db, patient, device, status, note=None):
    exam = Exam(
        patient_id=patient.id,
        doctor_id=patient.doctor_id,
        device_id=device.id,
        point="AV",
        status=status,
        doctor_note=note,
        doctor_agrees_with_ai=True if note else None,
        reviewed_at=datetime.now(UTC) if status == ExamStatus.REVIEWED else None,
    )
    db.add(exam)
    db.flush()
    db.add(AIResult(exam_id=exam.id, model_name="dummy", model_version="0.1.0", quality="unknown", label="murmur"))
    db.commit()
    return exam


@pytest.fixture
def world(db):
    """Two doctors, each with a patient (with login) and a device."""
    doctor_a = make_user(db, "dr.a", Role.DOCTOR)
    doctor_b = make_user(db, "dr.b", Role.DOCTOR)
    device_a, _ = make_device(db, "A", doctor_a)
    device_b, _ = make_device(db, "B", doctor_b)
    ali = patient_with_login(db, doctor_a, "ali", "Ali Valiyev")
    vali = patient_with_login(db, doctor_b, "vali", "Vali Aliyev")
    return {"doctor_a": doctor_a, "device_a": device_a, "device_b": device_b, "ali": ali, "vali": vali}


def test_patient_sees_only_own_reviewed_exams(client, db, world):
    ali, vali = world["ali"], world["vali"]
    reviewed = add_exam(db, ali, world["device_a"], ExamStatus.REVIEWED, note="Ali's note")
    for status in (ExamStatus.WAITING, ExamStatus.RECORDING, ExamStatus.UPLOADED, ExamStatus.ANALYZED, ExamStatus.FAILED):
        add_exam(db, ali, world["device_a"], status)
    add_exam(db, vali, world["device_b"], ExamStatus.REVIEWED, note="Vali's note")

    exams = client.get("/api/me/exams", headers=login(client, "ali")).json()

    assert [e["id"] for e in exams] == [reviewed.id]
    assert exams[0]["doctor_note"] == "Ali's note"
    assert "Vali" not in str(exams)


def test_patient_never_sees_raw_ai_results(client, db, world):
    add_exam(db, world["ali"], world["device_a"], ExamStatus.REVIEWED, note="ok")

    body = client.get("/api/me/exams", headers=login(client, "ali")).text

    for hidden in ("murmur", "dummy", "label", "ai_result", "quality", "agrees"):
        assert hidden not in body


def test_patient_sees_only_own_profile(client, world):
    profile = client.get("/api/me", headers=login(client, "ali")).json()

    assert profile["full_name"] == "Ali Valiyev"
    assert "Vali Aliyev" not in str(profile)


def test_patient_cannot_reach_other_data_by_id(client, db, world):
    vali_exam = add_exam(db, world["vali"], world["device_b"], ExamStatus.REVIEWED, note="x")
    headers = login(client, "ali")

    assert client.get(f"/api/patients/{world['vali'].id}", headers=headers).status_code == 403
    assert client.get(f"/api/exams/{vali_exam.id}", headers=headers).status_code == 403
    assert client.get(f"/api/exams/{vali_exam.id}/audio", headers=headers).status_code == 403


def test_patient_reads_are_audited(client, db, world):
    headers = login(client, "ali")
    client.get("/api/me", headers=headers)
    client.get("/api/me/exams", headers=headers)

    rows = db.scalars(select(AuditLog).order_by(AuditLog.id)).all()

    assert [(r.action, r.object_id) for r in rows] == [("me.read", world["ali"].id), ("me.exams.list", world["ali"].id)]


def test_only_patients_use_me_endpoints(client, db, world):
    make_user(db, "admin", Role.ADMIN)
    for username in ("admin", "dr.a"):
        headers = login(client, username)
        assert client.get("/api/me", headers=headers).status_code == 403
        assert client.get("/api/me/exams", headers=headers).status_code == 403
    assert client.get("/api/me").status_code == 401


def test_admin_cannot_read_medical_data(client, db, world):
    exam = add_exam(db, world["ali"], world["device_a"], ExamStatus.REVIEWED, note="Private note")
    make_user(db, "admin", Role.ADMIN)
    admin = login(client, "admin")

    for path in (f"/api/exams/{exam.id}", f"/api/exams/{exam.id}/audio", f"/api/patients/{world['ali'].id}", "/api/patients"):
        assert client.get(path, headers=admin).status_code == 403

    everything_admin_can_see = "".join(
        client.get(path, headers=admin).text
        for path in ("/api/admin/doctors", "/api/admin/devices", "/api/admin/stats", "/api/admin/audit")
    )
    # admin may see which model is running (stats), but never a patient's name, note or AI label
    for medical in ("Private note", "Ali Valiyev", "murmur"):
        assert medical not in everything_admin_can_see


def test_blocked_doctors_patients_can_still_see_their_results(client, db, world):
    """Blocking a doctor stops the doctor, not their patients."""
    add_exam(db, world["ali"], world["device_a"], ExamStatus.REVIEWED, note="ok")
    world["doctor_a"].is_active = False
    db.commit()

    assert len(client.get("/api/me/exams", headers=login(client, "ali")).json()) == 1


def test_ids_beyond_the_database_range_are_invalid_input_not_server_errors(client, db, world):
    """Ids are 32-bit in PostgreSQL; a bigger number must be a 422, never a 500."""
    huge = 99_999_999_999
    make_user(db, "admin", Role.ADMIN)
    doctor = login(client, "dr.a")
    admin = login(client, "admin")

    assert client.get(f"/api/patients/{huge}", headers=doctor).status_code == 422
    assert client.get(f"/api/exams/{huge}", headers=doctor).status_code == 422
    exam_body = {"patient_id": huge, "device_id": world["device_a"].id, "point": "MV"}
    assert client.post("/api/exams", headers=doctor, json=exam_body).status_code == 422
    assert client.post(f"/api/admin/doctors/{huge}/block", headers=admin).status_code == 422
    assert client.patch(f"/api/admin/devices/{huge}", headers=admin, json={"doctor_id": None}).status_code == 422
    device_body = {"doctor_id": huge}
    assert client.patch(f"/api/admin/devices/{world['device_a'].id}", headers=admin, json=device_body).status_code == 422
    assert client.get(f"/api/patients/{huge}").status_code == 401, "auth is still checked first"
