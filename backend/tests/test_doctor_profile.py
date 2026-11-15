"""Doctor profile: own page, the admin view of it, account status, and the admin patient list."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.models import AuditLog, Exam, ExamStatus, Role, Sex
from tests.helpers import login, make_device, make_patient, make_user


@pytest.fixture
def admin(client, db):
    make_user(db, "admin", Role.ADMIN)
    return login(client, "admin")


def add_exam(db, patient, device, status, *, created=None, reviewed_after=None):
    created = created or datetime.now(UTC)
    exam = Exam(
        patient_id=patient.id,
        doctor_id=patient.doctor_id,
        device_id=device.id,
        point="AV",
        status=status,
        created_at=created,
        reviewed_at=created + reviewed_after if reviewed_after else None,
    )
    db.add(exam)
    db.commit()
    return exam


def test_status_is_invited_until_the_first_sign_in_and_suspended_when_blocked(client, db, admin):
    doctor = make_user(db, "dr.new", Role.DOCTOR)

    def status():
        return client.get(f"/api/admin/doctors/{doctor.id}", headers=admin).json()["status"]

    assert status() == "invited"
    assert client.get("/api/admin/doctors", headers=admin).json()[0]["last_login_at"] is None
    login(client, "dr.new")
    assert status() == "active"
    client.post(f"/api/admin/doctors/{doctor.id}/block", headers=admin)
    assert status() == "suspended"


def test_password_change_time_is_remembered(client, db, admin):
    doctor = make_user(db, "dr.pw", Role.DOCTOR)
    assert client.get(f"/api/admin/doctors/{doctor.id}", headers=admin).json()["password_changed_at"] is None
    client.post(f"/api/admin/doctors/{doctor.id}/password", headers=admin, json={"password": "brand-new-pass-1"})
    assert client.get(f"/api/admin/doctors/{doctor.id}", headers=admin).json()["password_changed_at"] is not None


def test_workload_counts_the_doctors_own_exams(client, db):
    doctor = make_user(db, "dr.busy", Role.DOCTOR)
    other = make_user(db, "dr.other", Role.DOCTOR)
    device, _ = make_device(db, "D1", doctor)
    ali = make_patient(db, doctor, "Ali Valiyev")
    vali = make_patient(db, doctor, "Vali Aliyev")
    other_device, _ = make_device(db, "D2", other)
    add_exam(db, ali, device, ExamStatus.ANALYZED)
    add_exam(db, ali, device, ExamStatus.REVIEWED, reviewed_after=timedelta(minutes=10))
    add_exam(db, vali, device, ExamStatus.REVIEWED, reviewed_after=timedelta(minutes=20))
    add_exam(db, vali, device, ExamStatus.WAITING)  # not a recording yet
    add_exam(
        db,
        vali,
        device,
        ExamStatus.REVIEWED,
        created=datetime.now(UTC) - timedelta(days=40),
        reviewed_after=timedelta(hours=9),
    )
    add_exam(db, make_patient(db, other, "Not Mine"), other_device, ExamStatus.ANALYZED)

    body = client.get("/api/profile", headers=login(client, "dr.busy")).json()

    assert body["workload"] == {
        "patients": 2,
        "seen_today": 2,
        "recordings_30d": 3,
        "devices_30d": 1,
        "needs_review": 1,
        "median_review_minutes": 15,
    }
    assert [d["serial"] for d in body["devices"]] == ["D1"]


def test_admin_sees_a_doctors_patients_but_no_medical_data(client, db, admin):
    doctor = make_user(db, "dr.a", Role.DOCTOR)
    device, _ = make_device(db, "D1", doctor)
    patient = make_patient(db, doctor, "Ali Valiyev")
    exam = add_exam(db, patient, device, ExamStatus.REVIEWED, reviewed_after=timedelta(minutes=5))
    exam.doctor_note = "secret note"
    db.commit()

    response = client.get(f"/api/admin/doctors/{doctor.id}/patients", headers=admin)

    assert response.status_code == 200
    assert [p["full_name"] for p in response.json()] == ["Ali Valiyev"]
    assert set(response.json()[0]) == {"id", "full_name", "birth_year", "sex", "last_exam_at"}
    assert "secret note" not in response.text
    profile = client.get(f"/api/admin/doctors/{doctor.id}", headers=admin).text
    assert "Ali Valiyev" not in profile  # the profile itself carries counts only
    logged = db.scalars(select(AuditLog).where(AuditLog.action == "doctor.patients")).all()
    assert len(logged) == 1


def test_admin_list_handles_every_sex_value(client, db, admin):
    doctor = make_user(db, "dr.a", Role.DOCTOR)
    patient = make_patient(db, doctor, "Alex Doe")
    patient.sex = Sex.OTHER
    db.commit()

    response = client.get(f"/api/admin/doctors/{doctor.id}/patients", headers=admin)

    assert response.status_code == 200
    assert response.json()[0]["sex"] == "other"


def test_activity_lists_the_actions_of_that_doctor_only(client, db, admin):
    doctor = make_user(db, "dr.a", Role.DOCTOR)
    other = make_user(db, "dr.b", Role.DOCTOR)
    make_patient(db, doctor, "Ali Valiyev")
    client.post(
        "/api/patients",
        headers=login(client, "dr.a"),
        json={
            "full_name": "New Person",
            "birth_year": 1990,
            "sex": "male",
            "height_cm": 170,
            "weight_kg": 65,
            "consent_given": True,
        },
    )
    db.add(AuditLog(user_id=other.id, action="exam.read", object_type="exam", object_id=1))
    db.commit()

    mine = client.get("/api/profile/activity", headers=login(client, "dr.a")).json()
    seen_by_admin = client.get(f"/api/admin/doctors/{doctor.id}/activity", headers=admin).json()

    assert [e["action"] for e in mine] == ["patient.create"]
    assert seen_by_admin == mine
    assert "New Person" not in str(mine)


def test_profile_access_rules(client, db, admin):
    doctor = make_user(db, "dr.a", Role.DOCTOR)
    make_user(db, "dr.b", Role.DOCTOR)
    make_user(db, "pat.ient", Role.PATIENT)
    path = f"/api/admin/doctors/{doctor.id}"

    for suffix in ("", "/patients", "/activity"):
        assert client.get(path + suffix).status_code == 401
        assert client.get(path + suffix, headers=login(client, "dr.b")).status_code == 403
    assert client.get("/api/profile").status_code == 401
    assert client.get("/api/profile", headers=login(client, "pat.ient")).status_code == 403
    assert client.get("/api/profile", headers=admin).status_code == 403
    assert client.get("/api/admin/doctors/9999", headers=admin).status_code == 404
    assert client.get(f"/api/admin/doctors/{make_user(db, 'p2', Role.PATIENT).id}", headers=admin).status_code == 404


def test_name_and_clinic_are_edited_together_or_alone(client, db, admin):
    doctor = make_user(db, "dr.a", Role.DOCTOR)
    url = f"/api/admin/doctors/{doctor.id}"

    assert client.patch(url, headers=admin, json={"full_name": "  New Name "}).json()["full_name"] == "New Name"
    assert client.patch(url, headers=admin, json={"clinic": "Lakeside"}).json()["full_name"] == "New Name"
    both = client.patch(url, headers=admin, json={"full_name": "Third", "clinic": ""}).json()
    assert (both["full_name"], both["clinic"]) == ("Third", None)
    assert client.patch(url, headers=admin, json={}).status_code == 422
    assert client.patch(url, headers=admin, json={"full_name": None}).status_code == 422
