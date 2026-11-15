from datetime import timedelta

import pytest
from sqlalchemy import select

from app.models import AuditLog, CommandStatus, Device, DeviceCommand, Exam, ExamStatus, Recording, Role, VitalSigns
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
    body = {
        "full_name": "Ali",
        "birth_year": 1990,
        "sex": "male",
        "height_cm": 175,
        "weight_kg": 70,
        "consent_given": True,
    }

    assert client.post("/api/patients", headers=headers, json=body).json()["consent_given_at"] is not None


def test_invalid_patient_data_is_rejected(client, headers):
    bad = {"full_name": "Ali", "birth_year": 1800, "sex": "robot", "height_cm": 175, "weight_kg": 70}

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
    assert (
        client.post(
            "/api/exams", headers=headers, json={"patient_id": my_patient.id, "device_id": my_device.id, "point": "XX"}
        ).status_code
        == 422
    )


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


def add_ai_result(db, exam, label="murmur", quality="good"):
    from app.models import AIResult

    db.add(AIResult(exam_id=exam.id, model_name="m", model_version="1", quality=quality, label=label, score=0.9))
    db.commit()


def test_review_only_after_analysis(client, db, headers, doctor):
    exam = make_exam(db, doctor, ExamStatus.UPLOADED)
    add_ai_result(db, exam)
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

    empty_note = client.patch(
        f"/api/exams/{mine.id}/review", headers=headers, json={"note": "", "agrees_with_ai": True}
    )
    other = client.patch(f"/api/exams/{theirs.id}/review", headers=headers, json={"note": "x", "agrees_with_ai": False})

    assert empty_note.status_code == 422
    assert other.status_code == 404


@pytest.mark.parametrize(
    ("label", "quality", "agrees", "expected"),
    [
        ("murmur", "good", None, 400),  # the AI answered: the doctor must say whether they agree
        ("absent", "good", False, 200),
        ("not_analyzed", "unknown", True, 400),  # no answer: nothing to agree with
        ("not_analyzed", "unknown", None, 200),
        ("murmur", "bad", None, 200),  # too poor to judge = no answer
        (None, None, None, 200),  # analyzed without an AI row (e.g. stored result lost): no answer
    ],
)
def test_review_asks_for_agreement_only_if_ai_answered(client, db, headers, doctor, label, quality, agrees, expected):
    exam = make_exam(db, doctor, ExamStatus.ANALYZED)
    if label:
        add_ai_result(db, exam, label, quality)
    body = {"note": "ok"} if agrees is None else {"note": "ok", "agrees_with_ai": agrees}

    response = client.patch(f"/api/exams/{exam.id}/review", headers=headers, json=body)

    assert response.status_code == expected
    if expected == 200:
        assert response.json()["doctor_agrees_with_ai"] is agrees
    else:
        db.refresh(exam)
        assert exam.status == ExamStatus.ANALYZED


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
    ("post", "/api/patients/1/reset-password"),
    ("post", "/api/exams/1/cancel"),
    ("patch", "/api/patients/1"),
    ("delete", "/api/patients/1"),
]


@pytest.mark.parametrize(("method", "path"), DOCTOR_ENDPOINTS)
@pytest.mark.parametrize("role", [Role.ADMIN, Role.PATIENT])
def test_only_doctors_can_use_doctor_endpoints(client, db, method, path, role):
    make_user(db, "someone", role)
    headers = login(client, "someone", admin=role == Role.ADMIN)

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
        return lambda session: patients.create_patient_login(
            session, session.get(type(doctor), doctor.id), patient.id, username
        )

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
        return lambda session: patients.create_patient_login(
            session, session.get(type(doctor), doctor.id), patient_id, "same.name"
        )

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


def test_exam_detail_poll_uses_few_queries(client, db, headers, doctor):
    """The exam page polls every second: token user + exam (with recording and AI result) + "logged recently?"."""
    from sqlalchemy import event

    from app.db import engine
    from app.models import AIResult

    exam = make_exam(db, doctor, ExamStatus.ANALYZED)
    db.add(Recording(exam_id=exam.id, file_name="a" * 32 + ".wav", size_bytes=1, sample_rate=4000, duration_s=1))
    db.add(AIResult(exam_id=exam.id, model_name="dummy", model_version="0", quality="unknown", label="x"))
    db.commit()
    statements: list[str] = []

    def count(conn, cursor, statement, *args):
        statements.append(statement.split()[0])

    event.listen(engine, "before_cursor_execute", count)
    try:
        response = client.get(f"/api/exams/{exam.id}", headers=headers)
    finally:
        event.remove(engine, "before_cursor_execute", count)

    assert response.json()["recording"] and response.json()["ai_result"]
    assert statements.count("SELECT") <= 3, statements


def test_repeated_reads_are_logged_once_per_five_minutes_changes_always(client, db, headers, doctor):
    exam = make_exam(db, doctor, ExamStatus.ANALYZED)
    for _ in range(5):  # the live page polling
        assert client.get(f"/api/exams/{exam.id}", headers=headers).status_code == 200
    client.patch(f"/api/exams/{exam.id}/review", headers=headers, json={"note": "ok"})
    assert audit_actions(db) == [("exam.read", exam.id), ("exam.review", exam.id)]

    first = db.scalars(select(AuditLog).where(AuditLog.action == "exam.read")).one()
    first.created_at = first.created_at - timedelta(minutes=6)  # the window has passed
    db.commit()
    client.get(f"/api/exams/{exam.id}", headers=headers)
    assert [a for a in audit_actions(db) if a[0] == "exam.read"] == [("exam.read", exam.id)] * 2


def test_doctor_resets_patients_forgotten_password(client, db, headers, doctor):
    patient = make_patient(db, doctor)
    created = client.post(f"/api/patients/{patient.id}/login", headers=headers, json={"username": "ali.v"}).json()
    first = client.post("/api/auth/login", json={"username": "ali.v", "password": created["temporary_password"]})
    patient_session = {"Authorization": f"Bearer {first.json()['access_token']}"}

    reset = client.post(f"/api/patients/{patient.id}/reset-password", headers=headers)

    assert reset.status_code == 200
    new_temp = reset.json()["temporary_password"]
    assert reset.json()["username"] == "ali.v"
    assert new_temp != created["temporary_password"]
    old_pw = client.post("/api/auth/login", json={"username": "ali.v", "password": created["temporary_password"]})
    assert old_pw.status_code == 401
    assert client.post("/api/auth/change-password", headers=patient_session, json={}).status_code == 401
    relogin = client.post("/api/auth/login", json={"username": "ali.v", "password": new_temp})
    assert relogin.json()["must_change_password"] is True


def test_patient_password_reset_needs_own_patient_with_a_login(client, db, headers, doctor, other_doctor):
    no_login = make_patient(db, doctor, "No Login")
    theirs = make_patient(db, other_doctor, "Theirs")

    assert client.post(f"/api/patients/{no_login.id}/reset-password", headers=headers).status_code == 409
    assert client.post(f"/api/patients/{theirs.id}/reset-password", headers=headers).status_code == 404


# --- edit patient ---


def test_doctor_fixes_patient_data(client, db, headers, doctor):
    patient = make_patient(db, doctor, "Ali Valiev")
    client.post(f"/api/patients/{patient.id}/login", headers=headers, json={"username": "ali.v"})

    response = client.patch(
        f"/api/patients/{patient.id}",
        headers=headers,
        json={"full_name": "Ali Valiyev", "weight_kg": 72.5, "height_cm": None},
    )

    assert response.status_code == 200
    body = response.json()
    assert (body["full_name"], body["weight_kg"], body["height_cm"], body["birth_year"]) == (
        "Ali Valiyev",
        72.5,
        None,
        1990,
    )
    db.expire_all()
    from app.models import User

    assert db.scalar(select(User).where(User.username == "ali.v")).full_name == "Ali Valiyev"
    assert ("patient.update", patient.id) in audit_actions(db)


def test_patient_update_rejects_clearing_required_fields_and_bad_values(client, db, headers, doctor):
    patient = make_patient(db, doctor)

    for body in ({"full_name": None}, {"birth_year": None}, {"sex": None}, {"birth_year": 1800}, {"sex": "x"}):
        assert client.patch(f"/api/patients/{patient.id}", headers=headers, json=body).status_code == 422, body


def test_cannot_edit_another_doctors_patient(client, db, headers, other_doctor):
    theirs = make_patient(db, other_doctor)

    assert client.patch(f"/api/patients/{theirs.id}", headers=headers, json={"full_name": "X"}).status_code == 404


# --- delete patient ---


def test_delete_patient_erases_everything_and_keeps_only_ids_in_audit(client, db, headers, doctor):
    from app.config import get_settings
    from app.models import AIResult, Patient, User

    keep = make_patient(db, doctor, "Keep Me")
    keep_exam = make_exam(db, doctor, ExamStatus.WAITING)
    patient = make_patient(db, doctor, "Erase Me")
    created = client.post(f"/api/patients/{patient.id}/login", headers=headers, json={"username": "erase.me"}).json()
    first = client.post("/api/auth/login", json={"username": "erase.me", "password": created["temporary_password"]})
    patient_token = {"Authorization": f"Bearer {first.json()['access_token']}"}
    db.refresh(patient)  # the login was created through the API, outside this session
    patient_user_id = patient.user_id
    assert patient_user_id is not None
    device, _ = make_device(db, "MM-DEL", doctor)
    exam = Exam(patient_id=patient.id, doctor_id=doctor.id, device_id=device.id, point="MV", status=ExamStatus.ANALYZED)
    db.add(exam)
    db.flush()
    file_name = storage.save_recording(b"RIFF....WAVE")
    db.add_all(
        [
            Recording(exam_id=exam.id, file_name=file_name, size_bytes=12, sample_rate=4000, duration_s=20),
            AIResult(exam_id=exam.id, model_name="dummy", model_version="0", quality="unknown", label="x"),
            DeviceCommand(exam_id=exam.id, device_id=device.id, status=CommandStatus.DONE),
            AuditLog(user_id=patient_user_id, action="me.read", object_type="patient", object_id=patient.id),
        ]
    )
    db.commit()
    exam_id, patient_id = exam.id, patient.id

    response = client.delete(f"/api/patients/{patient_id}", headers=headers)

    assert response.status_code == 204
    db.expire_all()
    assert db.get(Patient, patient_id) is None
    assert db.get(User, patient_user_id) is None
    assert db.get(Exam, exam_id) is None
    assert db.scalar(select(Recording).where(Recording.exam_id == exam_id)) is None
    assert db.scalar(select(AIResult).where(AIResult.exam_id == exam_id)) is None
    assert db.scalar(select(DeviceCommand).where(DeviceCommand.exam_id == exam_id)) is None
    assert not (get_settings().recordings_path / file_name).exists()
    # the deleted patient can no longer use their session or log in
    assert client.get("/api/auth/me", headers=patient_token).status_code == 401
    assert (
        client.post(
            "/api/auth/login", json={"username": "erase.me", "password": created["temporary_password"]}
        ).status_code
        == 401
    )
    # other data untouched
    assert db.get(Patient, keep.id) is not None and db.get(Exam, keep_exam.id) is not None
    # audit: the delete is logged; the patient's old read stays as a bare id
    assert ("patient.delete", patient_id) in audit_actions(db)
    old_read = db.scalar(select(AuditLog).where(AuditLog.action == "me.read"))
    assert old_read.user_id == patient_user_id
    make_user(db, "admin", Role.ADMIN)
    entries = client.get("/api/admin/audit", headers=login(client, "admin")).json()
    entry = next(e for e in entries if e["action"] == "me.read")
    assert (entry["user_id"], entry["username"]) == (patient_user_id, None)
    assert "Erase Me" not in str(entries)


def test_cannot_delete_another_doctors_patient(client, db, headers, other_doctor):
    from app.models import Patient

    theirs = make_patient(db, other_doctor)

    assert client.delete(f"/api/patients/{theirs.id}", headers=headers).status_code == 404
    assert db.get(Patient, theirs.id) is not None


def test_delete_patient_without_login_or_exams(client, db, headers, doctor):
    patient = make_patient(db, doctor)

    assert client.delete(f"/api/patients/{patient.id}", headers=headers).status_code == 204
    assert client.get(f"/api/patients/{patient.id}", headers=headers).status_code == 404


def test_every_doctor_action_that_returns_patient_data_is_audited(client, db, headers, doctor):
    device, _ = make_device(db, "MM-AUD", doctor)
    created = client.post(
        "/api/patients",
        headers=headers,
        json={"full_name": "A", "birth_year": 1990, "sex": "male", "height_cm": 170, "weight_kg": 65},
    ).json()
    client.post(f"/api/patients/{created['id']}/consent", headers=headers)
    body = {"patient_id": created["id"], "device_id": device.id, "point": "MV"}
    first = client.post("/api/exams", headers=headers, json=body).json()
    second = client.post("/api/exams", headers=headers, json=body).json()
    client.post(f"/api/exams/{first['id']}/cancel", headers=headers)
    db.get(Exam, second["id"]).status = ExamStatus.ANALYZED
    db.commit()
    client.patch(f"/api/exams/{second['id']}/review", headers=headers, json={"note": "ok"})

    assert audit_actions(db) == [
        ("patient.create", created["id"]),
        ("patient.consent", created["id"]),
        ("exam.start", first["id"]),
        ("exam.start", second["id"]),
        ("exam.cancel", first["id"]),
        ("exam.review", second["id"]),
    ]


def test_start_exam_while_patient_is_being_deleted_gives_404(db, doctor, monkeypatch):
    import threading
    import time

    from app.db import SessionLocal
    from app.services import audit, exams, patients
    from app.services.errors import NotFound

    patient = make_patient(db, doctor)
    device, _ = make_device(db, "MM-RACE", doctor)
    real_record = audit.record

    def slow_record(session, user, action, *args):
        if action == "patient.delete":  # the delete holds the patient lock and has not committed yet
            time.sleep(0.6)
        real_record(session, user, action, *args)

    monkeypatch.setattr(audit, "record", slow_record)
    outcome: dict = {}

    def delete():
        with SessionLocal() as session:
            patients.delete_patient(session, session.get(type(doctor), doctor.id), patient.id)

    def start():
        with SessionLocal() as session:
            try:
                exams.start_exam(session, session.get(type(doctor), doctor.id), patient.id, device.id, "MV")
                outcome["start"] = "created"
            except NotFound:
                outcome["start"] = "404"
            except Exception as exc:
                outcome["start"] = repr(exc)

    deleter = threading.Thread(target=delete)
    deleter.start()
    time.sleep(0.2)
    starter = threading.Thread(target=start)
    starter.start()
    deleter.join(10)
    starter.join(10)

    assert outcome["start"] == "404"
    assert db.scalar(select(Exam)) is None


# --- lists for the web app ---


def test_patient_list_search_sort_and_paging(client, db, headers, doctor, other_doctor):
    for name in ["Zarina Karimova", "ali valiyev", "Bobur Aliev", "100%_real"]:
        make_patient(db, doctor, name)
    make_patient(db, other_doctor, "Ali Other")

    def names(query=""):
        return [p["full_name"] for p in client.get(f"/api/patients{query}", headers=headers).json()]

    assert names() == ["100%_real", "ali valiyev", "Bobur Aliev", "Zarina Karimova"], "sorted by name, own only"
    assert names("?q=ALI") == ["ali valiyev", "Bobur Aliev"], "case-insensitive, any part"
    assert names("?q=%25") == ["100%_real"], "% is matched literally"
    assert names("?q=_") == ["100%_real"], "_ is matched literally"
    assert names("?limit=2&offset=1") == ["ali valiyev", "Bobur Aliev"]


# --- patient registry (list with last exam + status, summary) ---


def add_exam(db, patient, device, status, *, label=None, quality="good", agrees=None, age=timedelta(0)):
    from datetime import UTC, datetime

    from app.models import AIResult

    exam = Exam(
        patient_id=patient.id,
        doctor_id=patient.doctor_id,
        device_id=device.id,
        point="MV",
        status=status,
        doctor_agrees_with_ai=agrees,
        created_at=datetime.now(UTC) - age,
    )
    db.add(exam)
    db.flush()
    if label:
        db.add(AIResult(exam_id=exam.id, model_name="dummy", model_version="0.1", quality=quality, label=label))
    db.commit()
    return exam


@pytest.fixture
def registry(db, doctor):
    """Anna: abnormal, to review. Boris: normal, to review. Carla: pending. Dina: no exam. Egor: failed."""
    device, _ = make_device(db, "R1", doctor)
    anna, boris, carla, dina, egor = (make_patient(db, doctor, n) for n in ("Anna", "Boris", "Carla", "Dina", "Egor"))
    add_exam(db, anna, device, ExamStatus.ANALYZED, label="murmur", age=timedelta(hours=3))
    add_exam(db, boris, device, ExamStatus.ANALYZED, label="absent", age=timedelta(hours=2))
    add_exam(db, carla, device, ExamStatus.UPLOADED, age=timedelta(hours=1))
    add_exam(db, egor, device, ExamStatus.FAILED, age=timedelta(days=3))
    return {"anna": anna, "boris": boris, "carla": carla, "dina": dina, "egor": egor}


def names(client, headers, **params):
    response = client.get("/api/patients", headers=headers, params=params)
    assert response.status_code == 200, response.text
    return [p["full_name"] for p in response.json()]


def test_registry_row_has_last_exam_and_status(client, headers, registry):
    rows = {p["full_name"]: p for p in client.get("/api/patients", headers=headers).json()}

    assert rows["Anna"]["result_status"] == "abnormal" and rows["Anna"]["needs_review"] is True
    assert rows["Anna"]["last_exam"]["point"] == "MV" and rows["Anna"]["last_exam"]["device_name"] == "Device R1"
    assert rows["Boris"]["result_status"] == "normal"
    assert rows["Carla"]["result_status"] == "pending" and rows["Carla"]["needs_review"] is False
    assert rows["Dina"]["last_exam"] is None and rows["Dina"]["result_status"] == "pending"
    assert rows["Egor"]["result_status"] == "failed"


def test_registry_uses_the_latest_exam_only(client, db, headers, doctor, registry):
    device = db.scalar(select(Exam.device_id).limit(1))
    anna = registry["anna"]
    db.add(Exam(patient_id=anna.id, doctor_id=doctor.id, device_id=device, point="AV", status=ExamStatus.WAITING))
    db.commit()

    row = next(p for p in client.get("/api/patients", headers=headers).json() if p["full_name"] == "Anna")

    assert row["last_exam"]["point"] == "AV" and row["result_status"] == "pending"


def test_registry_sorts(client, headers, registry):
    assert names(client, headers, sort="name") == ["Anna", "Boris", "Carla", "Dina", "Egor"]
    assert names(client, headers, sort="recent") == ["Carla", "Boris", "Anna", "Egor", "Dina"]
    assert names(client, headers, sort="priority") == ["Anna", "Egor", "Boris", "Carla", "Dina"]
    assert client.get("/api/patients?sort=nonsense", headers=headers).status_code == 422


def test_registry_status_filter_and_search(client, headers, registry):
    assert names(client, headers, status="needs_review", sort="name") == ["Anna", "Boris"]
    assert names(client, headers, status="pending", sort="name") == ["Carla", "Dina"]
    assert names(client, headers, q="ann") == ["Anna"]
    assert names(client, headers, limit=2, offset=1, sort="name") == ["Boris", "Carla"]


def test_reviewed_exam_leaves_the_review_tab(client, db, headers, doctor, registry):
    device = db.scalar(select(Device))
    add_exam(db, registry["anna"], device, ExamStatus.REVIEWED, label="murmur", agrees=True)

    row = next(p for p in client.get("/api/patients", headers=headers).json() if p["full_name"] == "Anna")

    assert row["needs_review"] is False and row["result_status"] == "abnormal"


def test_summary_counts_the_whole_roster(client, headers, registry):
    response = client.get("/api/patients/summary", headers=headers)

    assert response.status_code == 200
    assert response.json() == {"total": 5, "assigned_today": 3, "normal": 1, "needs_review": 2, "pending": 2}


def test_registry_and_summary_never_include_other_doctors(client, db, headers, other_doctor, registry):
    stranger = make_patient(db, other_doctor, "Stranger")
    device, _ = make_device(db, "R2", other_doctor)
    add_exam(db, stranger, device, ExamStatus.ANALYZED, label="murmur")

    assert "Stranger" not in names(client, headers)
    assert client.get("/api/patients/summary", headers=headers).json()["total"] == 5


def test_summary_is_for_doctors_only(client, db, headers):
    make_user(db, "admin.root", Role.ADMIN)
    make_user(db, "pat.ient", Role.PATIENT)
    _, key = make_device(db, "R3")

    assert client.get("/api/patients/summary").status_code == 401
    assert client.get("/api/patients/summary", headers=login(client, "admin.root")).status_code == 403
    assert client.get("/api/patients/summary", headers=login(client, "pat.ient")).status_code == 403
    assert client.get("/api/patients/summary", headers={"X-Device-Key": key}).status_code in (401, 403)


def test_summary_read_is_audited(client, db, headers, doctor):
    client.get("/api/patients/summary", headers=headers)

    assert ("patient.summary", None) in audit_actions(db)


def test_patient_clinic_is_a_snapshot_of_the_doctors_clinic(client, db, headers, doctor):
    doctor.clinic = "Highlands Clinic"
    db.commit()
    body = {"full_name": "Ali", "birth_year": 1990, "sex": "other", "height_cm": 175, "weight_kg": 70}

    created = client.post("/api/patients", headers=headers, json=body).json()
    doctor.clinic = "Lakeside Center"
    db.commit()

    assert created["sex"] == "other"
    assert created["clinic"] == "Highlands Clinic"
    assert client.get(f"/api/patients/{created['id']}", headers=headers).json()["clinic"] == "Highlands Clinic"


@pytest.mark.parametrize(
    ("field", "value"),
    [("height_cm", 29), ("height_cm", 251), ("weight_kg", 1), ("weight_kg", 401), ("height_cm", None)],
)
def test_measurements_are_required_and_bounded(client, headers, field, value):
    body = {"full_name": "Ali", "birth_year": 1990, "sex": "male", "height_cm": 175, "weight_kg": 70, field: value}

    assert client.post("/api/patients", headers=headers, json=body).status_code == 422


def test_patient_exam_rows_carry_what_the_history_table_shows(client, db, headers, doctor):
    doctor.clinic = "Highlands Clinic"
    device, _ = make_device(db, "MM-ROW", doctor)
    patient = make_patient(db, doctor)
    client.post(f"/api/patients/{patient.id}/consent", headers=headers)
    started = client.post(
        "/api/exams", headers=headers, json={"patient_id": patient.id, "device_id": device.id, "point": "AV"}
    ).json()

    rows = client.get(f"/api/patients/{patient.id}/exams", headers=headers).json()

    assert [r["id"] for r in rows] == [started["id"]]
    assert rows[0]["device_code"] == device.code
    assert rows[0]["clinic"] == "Highlands Clinic"
    assert rows[0]["result_status"] == "pending"
    assert rows[0]["duration_s"] is None
    assert rows[0]["ai_label"] is None


def test_doctor_devices_carry_what_the_profile_card_shows(client, db, headers, doctor):
    make_device(db, "MM-CARD", doctor)

    card = client.get("/api/devices", headers=headers).json()[0]

    assert card["code"].startswith("MM-")
    assert card["model"]
    assert {"location", "clinic", "battery_pct"} <= card.keys()


def test_vitals_are_saved_per_patient_and_the_newest_is_returned(client, db, headers, doctor):
    patient = make_patient(db, doctor)
    url = f"/api/patients/{patient.id}/vitals"
    assert client.get(f"{url}/latest", headers=headers).json() is None

    first = {"heart_rate": 80, "systolic": 120, "diastolic": 78, "spo2": 98, "resp_rate": 16, "temp_c": 36.6}
    assert client.post(url, headers=headers, json=first).status_code == 201
    assert client.post(url, headers=headers, json={"heart_rate": 92}).status_code == 201

    latest = client.get(f"{url}/latest", headers=headers).json()
    assert latest["heart_rate"] == 92
    assert latest["spo2"] is None
    assert latest["recorded_by"] == doctor.full_name


@pytest.mark.parametrize(
    "body",
    [{}, {"systolic": 120}, {"systolic": 70, "diastolic": 90}, {"heart_rate": 10}, {"spo2": 101}, {"temp_c": 50}],
)
def test_bad_vitals_are_rejected(client, db, headers, doctor, body):
    patient = make_patient(db, doctor)

    assert client.post(f"/api/patients/{patient.id}/vitals", headers=headers, json=body).status_code == 422


def test_vitals_of_another_doctors_patient_are_hidden_and_audited(client, db, headers, doctor, other_doctor):
    mine = make_patient(db, doctor, "Mine")
    theirs = make_patient(db, other_doctor, "Theirs")

    assert client.post(f"/api/patients/{theirs.id}/vitals", headers=headers, json={"heart_rate": 70}).status_code == 404
    assert client.get(f"/api/patients/{theirs.id}/vitals/latest", headers=headers).status_code == 404
    client.post(f"/api/patients/{mine.id}/vitals", headers=headers, json={"heart_rate": 70})
    client.get(f"/api/patients/{mine.id}/vitals/latest", headers=headers)
    actions = {a.action for a in db.scalars(select(AuditLog)).all()}
    assert {"patient.vitals.create", "patient.vitals.read"} <= actions


def test_deleting_a_patient_removes_their_vitals(client, db, headers, doctor):
    patient = make_patient(db, doctor)
    client.post(f"/api/patients/{patient.id}/vitals", headers=headers, json={"heart_rate": 70})

    assert client.delete(f"/api/patients/{patient.id}", headers=headers).status_code == 204
    assert db.scalars(select(VitalSigns)).all() == []
