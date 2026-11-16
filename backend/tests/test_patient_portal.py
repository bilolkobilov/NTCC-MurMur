"""The patient's own pages: profile, contact details, results with the AI's yes/no label."""

from datetime import UTC, datetime

import pytest

from app.models import AIResult, AuditLog, Exam, ExamStatus, Role, VitalSigns
from tests.helpers import login, make_device, make_patient, make_user


def make_login(db, doctor, username="ali", full_name="Ali Valiyev"):
    patient = make_patient(db, doctor, full_name)
    user = make_user(db, username, Role.PATIENT)
    patient.user_id = user.id
    db.commit()
    return patient


def add_reviewed(db, patient, device, *, label="absent", quality="good", score=0.2):
    exam = Exam(
        patient_id=patient.id,
        doctor_id=patient.doctor_id,
        device_id=device.id,
        point="MV",
        status=ExamStatus.REVIEWED,
        doctor_note="Looks fine.",
        doctor_agrees_with_ai=True,
        reviewed_at=datetime.now(UTC),
    )
    db.add(exam)
    db.flush()
    db.add(
        AIResult(exam_id=exam.id, model_name="cardiophon", model_version="1", quality=quality, label=label, score=score)
    )
    db.commit()
    return exam


@pytest.fixture
def world(db):
    doctor = make_user(db, "dr.a", Role.DOCTOR)
    doctor.clinic = "Highlands Clinic"
    other = make_user(db, "dr.b", Role.DOCTOR)
    device, _ = make_device(db, "A", doctor)
    db.commit()
    return {
        "doctor": doctor,
        "device": device,
        "ali": make_login(db, doctor),
        "vali": make_login(db, other, "vali", "Vali Aliyev"),
    }


def test_exam_carries_clinic_device_doctor_and_label(client, db, world):
    add_reviewed(db, world["ali"], world["device"], label="murmur")

    exam = client.get("/api/me/exams", headers=login(client, "ali")).json()[0]

    assert exam["ai_label"] == "murmur"
    assert exam["recording_quality"] == "good"
    assert exam["clinic"] == "Highlands Clinic"
    assert exam["device_code"] == world["device"].code
    assert exam["doctor_name"] == "Dr.A"


def test_label_is_hidden_when_the_ai_gave_no_answer(client, db, world):
    add_reviewed(db, world["ali"], world["device"], label="not_analyzed", quality="unknown")
    add_reviewed(db, world["ali"], world["device"], label="murmur", quality="bad")

    labels = [e["ai_label"] for e in client.get("/api/me/exams", headers=login(client, "ali")).json()]

    assert labels == [None, None]


def test_profile_shows_clinic_latest_analysis_and_heart_rate(client, db, world):
    add_reviewed(db, world["ali"], world["device"])
    db.add(VitalSigns(patient_id=world["ali"].id, doctor_id=world["doctor"].id, heart_rate=72))
    db.commit()

    profile = client.get("/api/me", headers=login(client, "ali")).json()

    assert profile["heart_rate"] == 72
    assert profile["doctor_clinic"] == "Highlands Clinic"
    assert profile["latest_analysis"]["device_code"] == world["device"].code
    assert profile["patient_id"] == world["ali"].id


def test_patient_edits_contact_details_and_it_is_audited(client, db, world):
    headers = login(client, "ali")

    response = client.patch(
        "/api/me",
        headers=headers,
        json={"phone": " +998 90 123 45 34 ", "email": "ali@example.com", "city": "Tashkent"},
    )

    assert response.status_code == 200
    assert response.json()["phone"] == "+998 90 123 45 34"
    assert client.get("/api/me", headers=headers).json()["city"] == "Tashkent"
    assert db.query(AuditLog).filter(AuditLog.action == "me.update").count() == 1


def test_empty_value_clears_a_field_and_unsent_fields_stay(client, world):
    headers = login(client, "ali")
    client.patch("/api/me", headers=headers, json={"city": "Tashkent", "phone": "+998901234567"})

    profile = client.patch("/api/me", headers=headers, json={"city": ""}).json()

    assert profile["city"] is None
    assert profile["phone"] == "+998901234567"


@pytest.mark.parametrize(
    "body",
    [
        {"full_name": "Someone Else"},  # managed by the clinic
        {"birth_year": 1980},
        {"email": "not-an-email"},
        {"phone": "abc"},
    ],
)
def test_patient_cannot_change_clinic_data_or_send_junk(client, world, body):
    assert client.patch("/api/me", headers=login(client, "ali"), json=body).status_code == 422


def test_only_a_patient_can_use_the_contact_endpoint(client, db, world):
    assert client.patch("/api/me", headers=login(client, "dr.a"), json={"city": "x"}).status_code == 403
    assert client.patch("/api/me", json={"city": "x"}).status_code == 401
