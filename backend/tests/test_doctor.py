import pytest
from sqlalchemy import select

from app.models import AuditLog, CommandStatus, DeviceCommand, Exam, ExamStatus, Recording, Role
from app.services import storage
from tests.helpers import login, make_device, make_patient, make_user


@pytest.fixture
def doctor(db):
    return make_user(db, "dr.aziz", Role.DOCTOR)


@pytest.fixture
def headers(client, doctor):
    return login(client, "dr.aziz")


@pytest.fixture
def other_doctor(db):
    return make_user(db, "dr.other", Role.DOCTOR)


def audit_actions(db) -> list[tuple[str, int | None]]:
    return [(a.action, a.object_id) for a in db.scalars(select(AuditLog).order_by(AuditLog.id))]


# --- patients ---


def test_create_patient(client, headers):
    body = {"full_name": "Ali Valiyev", "birth_year": 1990, "sex": "male", "height_cm": 175, "weight_kg": 70}

    response = client.post("/api/patients", headers=headers, json=body)

    assert response.status_code == 201
    patient = response.json()
    assert patient["full_name"] == "Ali Valiyev"
    assert patient["consent_given_at"] is None
    assert patient["has_login"] is False


def test_create_patient_with_consent(client, headers):
    body = {"full_name": "Ali", "birth_year": 1990, "sex": "male", "consent_given": True}

    assert client.post("/api/patients", headers=headers, json=body).json()["consent_given_at"] is not None


def test_invalid_patient_data_is_rejected(client, headers):
    bad = {"full_name": "Ali", "birth_year": 1800, "sex": "other"}

    assert client.post("/api/patients", headers=headers, json=bad).status_code == 422


def test_doctor_sees_only_own_patients(client, db, headers, doctor, other_doctor):
    mine = make_patient(db, doctor, "Mine")
    theirs = make_patient(db, other_doctor, "Theirs")

    listed = client.get("/api/patients", headers=headers).json()

    assert [p["full_name"] for p in listed] == ["Mine"]
    assert client.get(f"/api/patients/{mine.id}", headers=headers).status_code == 200
    assert client.get(f"/api/patients/{theirs.id}", headers=headers).status_code == 404
    assert client.get(f"/api/patients/{theirs.id}/exams", headers=headers).status_code == 404
    assert client.post(f"/api/patients/{theirs.id}/consent", headers=headers).status_code == 404
    other_login = client.post(f"/api/patients/{theirs.id}/login", headers=headers, json={"username": "theirs"})
    assert other_login.status_code == 404


def test_record_consent(client, db, headers, doctor):
    patient = make_patient(db, doctor, consent=False)

    response = client.post(f"/api/patients/{patient.id}/consent", headers=headers)

    assert response.status_code == 200
    assert response.json()["consent_given_at"] is not None


def test_reads_of_patient_data_are_audited(client, db, headers, doctor):
    patient = make_patient(db, doctor)

    client.get("/api/patients", headers=headers)
    client.get(f"/api/patients/{patient.id}", headers=headers)
    client.get(f"/api/patients/{patient.id}/exams", headers=headers)

    assert audit_actions(db) == [
        ("patient.list", None),
        ("patient.read", patient.id),
        ("patient.exams.list", patient.id),
    ]


# --- patient login ---


def test_create_patient_login_gives_one_time_password_that_must_be_changed(client, db, headers, doctor):
    patient = make_patient(db, doctor)

    response = client.post(f"/api/patients/{patient.id}/login", headers=headers, json={"username": "ali.v"})

    assert response.status_code == 201
    temp_password = response.json()["temporary_password"]
    login_response = client.post("/api/auth/login", json={"username": "ali.v", "password": temp_password})
    assert login_response.json()["role"] == "patient"
    assert login_response.json()["must_change_password"] is True
    assert client.get(f"/api/patients/{patient.id}", headers=headers).json()["has_login"] is True


def test_patient_gets_only_one_login_and_usernames_are_unique(client, db, headers, doctor):
    first = make_patient(db, doctor, "First")
    second = make_patient(db, doctor, "Second")
    client.post(f"/api/patients/{first.id}/login", headers=headers, json={"username": "ali.v"})

    again = client.post(f"/api/patients/{first.id}/login", headers=headers, json={"username": "ali.v2"})
    taken = client.post(f"/api/patients/{second.id}/login", headers=headers, json={"username": "ali.v"})

    assert again.status_code == 409
    assert taken.status_code == 409


# --- exams ---


def test_start_exam_creates_waiting_exam_and_device_command(client, db, headers, doctor):
    patient = make_patient(db, doctor)
    device, _ = make_device(db, "MM-001", doctor)

    response = client.post(
        "/api/exams", headers=headers, json={"patient_id": patient.id, "device_id": device.id, "point": "MV"}
    )

    assert response.status_code == 201
    exam = response.json()
    assert exam["status"] == "waiting"
    assert exam["point"] == "MV"
    command = db.scalar(select(DeviceCommand).where(DeviceCommand.exam_id == exam["id"]))
    assert command.device_id == device.id
    assert command.command == "record"
    assert command.duration_s == 20
    assert command.status == CommandStatus.PENDING


def test_exam_needs_consent(client, db, headers, doctor):
    patient = make_patient(db, doctor, consent=False)
    device, _ = make_device(db, "MM-001", doctor)

    response = client.post(
        "/api/exams", headers=headers, json={"patient_id": patient.id, "device_id": device.id, "point": "MV"}
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "patient consent is not recorded"
    assert db.scalar(select(Exam)) is None


def test_exam_needs_own_patient_and_own_device(client, db, headers, doctor, other_doctor):
    my_patient = make_patient(db, doctor)
    their_patient = make_patient(db, other_doctor)
    my_device, _ = make_device(db, "MM-001", doctor)
    their_device, _ = make_device(db, "MM-002", other_doctor)
    free_device, _ = make_device(db, "MM-003")

    def start(patient_id, device_id):
        body = {"patient_id": patient_id, "device_id": device_id, "point": "AV"}
        return client.post("/api/exams", headers=headers, json=body).status_code

    assert start(their_patient.id, my_device.id) == 404
    assert start(my_patient.id, their_device.id) == 404
    assert start(my_patient.id, free_device.id) == 404
    assert start(my_patient.id, 9999) == 404
    assert client.post("/api/exams", headers=headers, json={"patient_id": my_patient.id, "device_id": my_device.id, "point": "XX"}).status_code == 422


def make_exam(db, doctor, status=ExamStatus.WAITING):
    patient = make_patient(db, doctor)
    device, _ = make_device(db, f"MM-{patient.id}", doctor)
    exam = Exam(patient_id=patient.id, doctor_id=doctor.id, device_id=device.id, point="TV", status=status)
    db.add(exam)
    db.commit()
    return exam


def test_doctor_reads_own_exam_only_and_reads_are_audited(client, db, headers, doctor, other_doctor):
    mine = make_exam(db, doctor)
    theirs = make_exam(db, other_doctor)

    response = client.get(f"/api/exams/{mine.id}", headers=headers)

    assert response.status_code == 200
    assert response.json()["recording"] is None and response.json()["ai_result"] is None
    assert client.get(f"/api/exams/{theirs.id}", headers=headers).status_code == 404
    assert audit_actions(db) == [("exam.read", mine.id)]


def test_review_only_after_analysis(client, db, headers, doctor):
    exam = make_exam(db, doctor, ExamStatus.UPLOADED)
    body = {"note": "Systolic murmur, refer to cardiology", "agrees_with_ai": True}

    early = client.patch(f"/api/exams/{exam.id}/review", headers=headers, json=body)
    assert early.status_code == 409

    exam.status = ExamStatus.ANALYZED
    db.commit()
    reviewed = client.patch(f"/api/exams/{exam.id}/review", headers=headers, json=body)

    assert reviewed.status_code == 200
    assert reviewed.json()["status"] == "reviewed"
    assert reviewed.json()["doctor_note"] == body["note"]
    assert reviewed.json()["doctor_agrees_with_ai"] is True
    assert reviewed.json()["reviewed_at"] is not None
    assert client.patch(f"/api/exams/{exam.id}/review", headers=headers, json=body).status_code == 409


def test_review_needs_a_note_and_own_exam(client, db, headers, doctor, other_doctor):
    mine = make_exam(db, doctor, ExamStatus.ANALYZED)
    theirs = make_exam(db, other_doctor, ExamStatus.ANALYZED)

    empty_note = client.patch(f"/api/exams/{mine.id}/review", headers=headers, json={"note": "", "agrees_with_ai": True})
    other = client.patch(f"/api/exams/{theirs.id}/review", headers=headers, json={"note": "x", "agrees_with_ai": False})

    assert empty_note.status_code == 422
    assert other.status_code == 404


def test_exam_audio(client, db, headers, doctor):
    exam = make_exam(db, doctor, ExamStatus.UPLOADED)
    assert client.get(f"/api/exams/{exam.id}/audio", headers=headers).status_code == 404

    file_name = storage.save_recording(b"RIFF fake wav bytes")
    db.add(Recording(exam_id=exam.id, file_name=file_name, size_bytes=19, sample_rate=4000, duration_s=20))
    db.commit()

    response = client.get(f"/api/exams/{exam.id}/audio", headers=headers)

    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/wav"
    assert response.content == b"RIFF fake wav bytes"
    assert ("exam.audio", exam.id) in audit_actions(db)


# --- access ---

DOCTOR_ENDPOINTS = [
    ("get", "/api/patients"),
    ("post", "/api/patients"),
    ("get", "/api/patients/1"),
    ("post", "/api/patients/1/consent"),
    ("post", "/api/patients/1/login"),
    ("get", "/api/patients/1/exams"),
    ("post", "/api/exams"),
    ("get", "/api/exams/1"),
    ("get", "/api/exams/1/audio"),
    ("patch", "/api/exams/1/review"),
    ("get", "/api/devices"),
]


@pytest.mark.parametrize(("method", "path"), DOCTOR_ENDPOINTS)
@pytest.mark.parametrize("role", [Role.ADMIN, Role.PATIENT])
def test_only_doctors_can_use_doctor_endpoints(client, db, method, path, role):
    make_user(db, "someone", role)
    headers = login(client, "someone")

    assert client.request(method, path, headers=headers, json={}).status_code == 403
    assert client.request(method, path, json={}).status_code == 401


def _run_in_parallel(*jobs):
    """Start every job at the same moment in its own thread and DB session; return their results/exceptions."""
    import threading

    from app.db import SessionLocal

    barrier = threading.Barrier(len(jobs))
    results: list = [None] * len(jobs)

    def run(index, job):
        with SessionLocal() as session:
            barrier.wait()
            try:
                results[index] = job(session)
            except Exception as exc:  # collected and asserted by the test
                results[index] = exc

    threads = [threading.Thread(target=run, args=(i, job)) for i, job in enumerate(jobs)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)
    return results


def test_parallel_logins_for_one_patient_give_one_login_and_one_409(db, doctor):
    from app.models import Patient
    from app.services import patients
    from app.services.errors import Conflict

    patient = make_patient(db, doctor)

    def create_login(username):
        return lambda session: patients.create_patient_login(session, session.get(type(doctor), doctor.id), patient.id, username)

    results = _run_in_parallel(create_login("ali.one"), create_login("ali.two"))

    assert sum(isinstance(r, tuple) for r in results) == 1
    assert sum(isinstance(r, Conflict) for r in results) == 1
    db.expire_all()
    assert db.get(Patient, patient.id).user_id is not None


def test_parallel_same_username_gives_409_not_500(db, doctor):
    from app.services import patients
    from app.services.errors import Conflict

    first = make_patient(db, doctor, "First")
    second = make_patient(db, doctor, "Second")

    def create_login(patient_id):
        return lambda session: patients.create_patient_login(session, session.get(type(doctor), doctor.id), patient_id, "same.name")

    results = _run_in_parallel(create_login(first.id), create_login(second.id))

    assert sum(isinstance(r, tuple) for r in results) == 1
    assert sum(isinstance(r, Conflict) for r in results) == 1, results


def test_parallel_same_serial_gives_409_not_500(db):
    from app.services import devices
    from app.services.errors import Conflict

    def register(session):
        return devices.create_device(session, name="A", serial="MM-RACE", doctor_id=None)

    results = _run_in_parallel(register, register)

    assert sum(isinstance(r, tuple) for r in results) == 1
    assert sum(isinstance(r, Conflict) for r in results) == 1, results


def test_doctor_lists_only_own_devices_with_online_status(client, db, headers, doctor, other_doctor):
    from datetime import UTC, datetime

    mine, _ = make_device(db, "MM-MINE", doctor)
    make_device(db, "MM-THEIRS", other_doctor)
    make_device(db, "MM-FREE")
    mine.last_seen_at = datetime.now(UTC)
    db.commit()

    listed = client.get("/api/devices", headers=headers).json()

    assert [(d["serial"], d["online"]) for d in listed] == [("MM-MINE", True)]
    assert "api_key" not in str(listed) and "api_key_hash" not in str(listed)
