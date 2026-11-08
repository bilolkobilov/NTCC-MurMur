import json
import re

import pytest
from sqlalchemy import select

from app.config import get_settings
from app.models import AIResult, CommandStatus, Device, DeviceCommand, Exam, ExamStatus, Recording, Role
from app.services import analysis, storage
from tests.helpers import login, make_device, make_patient, make_user, make_wav


@pytest.fixture
def doctor(db):
    return make_user(db, "dr.aziz", Role.DOCTOR)


@pytest.fixture
def device_and_key(db, doctor):
    return make_device(db, "MM-001", doctor)


@pytest.fixture
def key(device_and_key):
    return {"X-Device-Key": device_and_key[1]}


@pytest.fixture
def exam(client, db, doctor, device_and_key):
    """An exam started by the doctor through the API (so a real command is queued)."""
    patient = make_patient(db, doctor)
    body = {"patient_id": patient.id, "device_id": device_and_key[0].id, "point": "MV"}
    response = client.post("/api/exams", headers=login(client, "dr.aziz"), json=body)
    assert response.status_code == 201
    return db.get(Exam, response.json()["id"])


def upload(client, key, exam_id, data=None, meta=None):
    files = {"audio": ("rec.wav", data if data is not None else make_wav(), "audio/wav")}
    form = {"meta": json.dumps(meta)} if isinstance(meta, dict) else ({"meta": meta} if meta else None)
    return client.post(f"/api/device/upload/{exam_id}", headers=key, files=files, data=form)


# --- auth ---


@pytest.mark.parametrize(
    ("method", "path"),
    [("post", "/api/device/heartbeat"), ("get", "/api/device/command"), ("post", "/api/device/upload/1")],
)
def test_device_endpoints_need_a_valid_key(client, db, method, path):
    make_user(db, "dr.aziz", Role.DOCTOR)
    user_token = login(client, "dr.aziz")

    assert client.request(method, path).status_code == 401
    assert client.request(method, path, headers={"X-Device-Key": "wrong-key"}).status_code == 401
    assert client.request(method, path, headers=user_token).status_code == 401


def test_device_key_does_not_open_user_endpoints(client, key):
    assert client.get("/api/patients", headers=key).status_code == 401
    assert client.get("/api/admin/devices", headers=key).status_code == 401


# --- heartbeat ---


def test_heartbeat_updates_status_and_makes_device_online(client, db, key, device_and_key):
    device = device_and_key[0]

    response = client.post("/api/device/heartbeat", headers=key, json={"firmware_version": "0.3.1", "wifi_rssi": -61})

    assert response.status_code == 200
    db.refresh(device)
    assert device.firmware_version == "0.3.1"
    assert device.wifi_rssi == -61
    assert device.last_seen_at is not None
    make_user(db, "admin", Role.ADMIN)
    listed = client.get("/api/admin/devices", headers=login(client, "admin")).json()
    assert listed[0]["online"] is True


def test_heartbeat_rejects_impossible_rssi(client, key):
    assert client.post("/api/device/heartbeat", headers=key, json={"wifi_rssi": 20}).status_code == 422


# --- commands ---


def test_no_command_means_204(client, key):
    assert client.get("/api/device/command", headers=key).status_code == 204


def test_poll_returns_command_once_and_exam_starts_recording(client, db, key, exam):
    first = client.get("/api/device/command", headers=key)

    assert first.status_code == 200
    assert first.json() == {"command": "record", "exam_id": exam.id, "duration_s": 20}
    db.refresh(exam)
    assert exam.status == ExamStatus.RECORDING
    command = db.scalar(select(DeviceCommand).where(DeviceCommand.exam_id == exam.id))
    assert command.status == CommandStatus.TAKEN and command.taken_at is not None
    assert client.get("/api/device/command", headers=key).status_code == 204


def test_device_only_gets_its_own_commands(client, db, doctor, exam):
    _, other_key = make_device(db, "MM-002", doctor)

    assert client.get("/api/device/command", headers={"X-Device-Key": other_key}).status_code == 204


# --- upload ---


def test_upload_saves_wav_and_runs_dummy_analysis(client, db, key, exam):
    client.get("/api/device/command", headers=key)

    response = upload(client, key, exam.id, make_wav(seconds=2, sample_rate=4000), {"motion_detected": True})

    assert response.status_code == 202
    assert response.json() == {"exam_id": exam.id, "status": "uploaded"}
    db.expire_all()
    recording = db.scalar(select(Recording).where(Recording.exam_id == exam.id))
    assert re.fullmatch(r"[0-9a-f]{32}\.wav", recording.file_name), "file name must be random, never a patient name"
    assert storage.recording_path(recording.file_name).read_bytes()[:4] == b"RIFF"
    assert recording.sample_rate == 4000
    assert recording.duration_s == pytest.approx(2.0)
    assert recording.motion_detected is True
    command = db.scalar(select(DeviceCommand).where(DeviceCommand.exam_id == exam.id))
    assert command.status == CommandStatus.DONE
    # the background task already ran (TestClient runs it before returning)
    result = db.scalar(select(AIResult).where(AIResult.exam_id == exam.id))
    assert (result.model_name, result.model_version) == ("dummy", "0.1.0")
    assert (result.quality, result.label, result.score) == ("unknown", "not_analyzed", None)
    assert db.get(Exam, exam.id).status == ExamStatus.ANALYZED


def test_upload_needs_the_exam_to_be_recording(client, key, exam):
    response = upload(client, key, exam.id)  # device never polled the command

    assert response.status_code == 409


def test_upload_twice_is_rejected(client, key, exam):
    client.get("/api/device/command", headers=key)
    assert upload(client, key, exam.id).status_code == 202

    assert upload(client, key, exam.id).status_code == 409


def test_upload_to_another_devices_exam_is_404(client, db, doctor, key, exam):
    _, other_key = make_device(db, "MM-002", doctor)
    client.get("/api/device/command", headers=key)

    assert upload(client, {"X-Device-Key": other_key}, exam.id).status_code == 404
    assert upload(client, key, 9999).status_code == 404


@pytest.mark.parametrize(
    "data",
    [b"not audio at all", b"RIFF\x00\x00\x00\x00WAVEjunk", b"", b"ID3\x03 an mp3 file pretending"],
)
def test_upload_accepts_wav_only(client, db, key, exam, data):
    client.get("/api/device/command", headers=key)

    response = upload(client, key, exam.id, data)

    assert response.status_code == 400
    db.refresh(exam)
    assert exam.status == ExamStatus.RECORDING
    assert db.scalar(select(Recording)) is None


def test_upload_size_limit(client, db, key, exam, monkeypatch):
    client.get("/api/device/command", headers=key)
    monkeypatch.setattr(get_settings(), "max_upload_mb", 0)

    response = upload(client, key, exam.id)

    assert response.status_code == 413
    assert db.scalar(select(Recording)) is None


def test_upload_rejects_broken_meta(client, key, exam):
    client.get("/api/device/command", headers=key)

    assert upload(client, key, exam.id, meta="{not json").status_code == 422
    assert upload(client, key, exam.id, meta={"motion_detected": "maybe"}).status_code == 422


def test_failing_analyzer_marks_exam_failed(client, db, key, exam, monkeypatch):
    class BrokenAnalyzer:
        name, version = "broken", "1"

        def analyze(self, data):
            raise RuntimeError("model crashed")

    monkeypatch.setattr(analysis.analyzer_module, "get_analyzer", lambda: BrokenAnalyzer())
    client.get("/api/device/command", headers=key)

    assert upload(client, key, exam.id).status_code == 202

    db.expire_all()
    failed = db.get(Exam, exam.id)
    assert failed.status == ExamStatus.FAILED
    assert failed.failure_reason == "analysis error: RuntimeError"
    assert db.scalar(select(AIResult)) is None


def test_device_assigned_elsewhere_after_exam_start_cannot_touch_it(client, db, key, exam, device_and_key):
    """Commands follow the device, but uploads are bound to the exam's device id, not the doctor."""
    client.get("/api/device/command", headers=key)
    device = db.get(Device, device_and_key[0].id)
    device.doctor_id = None
    db.commit()

    # the same physical device still finishes the exam it already started
    assert upload(client, key, exam.id).status_code == 202


def _wav_files() -> set[str]:
    return {p.name for p in get_settings().recordings_path.glob("*.wav")}


def test_simultaneous_uploads_store_exactly_one_recording(client, db, key, exam, device_and_key):
    """A retry that arrives while the first upload is still saving must get 409, not 500 + an orphan file."""
    import threading

    from app.db import SessionLocal
    from app.services import device_flow
    from app.services.errors import Conflict

    client.get("/api/device/command", headers=key)
    before = _wav_files()
    barrier = threading.Barrier(2)
    outcomes: list[str] = []

    def upload_in_own_session():
        with SessionLocal() as session:
            device = session.get(Device, device_and_key[0].id)
            barrier.wait()
            try:
                device_flow.accept_upload(session, device, exam.id, make_wav(), motion_detected=False)
                outcomes.append("ok")
            except Conflict:
                outcomes.append("conflict")

    threads = [threading.Thread(target=upload_in_own_session) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)

    assert sorted(outcomes) == ["conflict", "ok"]
    assert len(_wav_files() - before) == 1
    assert len(db.scalars(select(Recording).where(Recording.exam_id == exam.id)).all()) == 1


def test_failed_save_leaves_no_orphan_file(client, db, key, exam, monkeypatch):
    from app.services import exam_flow

    client.get("/api/device/command", headers=key)
    before = _wav_files()

    def broken_mark_uploaded(_exam):
        raise RuntimeError("database went away")

    monkeypatch.setattr(exam_flow, "mark_uploaded", broken_mark_uploaded)
    with pytest.raises(RuntimeError):
        upload(client, key, exam.id)

    assert _wav_files() == before
    db.expire_all()
    assert db.get(Exam, exam.id).status == ExamStatus.RECORDING
    assert db.scalar(select(Recording)) is None


def test_oversized_upload_is_rejected_before_the_body_is_read(client, db, key, exam, monkeypatch):
    from app.services import device_flow

    client.get("/api/device/command", headers=key)
    monkeypatch.setattr(get_settings(), "max_upload_mb", 0)
    monkeypatch.setattr(device_flow, "accept_upload", lambda *a, **k: pytest.fail("handler must not run"))

    response = upload(client, key, exam.id, make_wav(seconds=30))  # ~240 KB > 0 MB + 64 KB overhead

    assert response.status_code == 413
    assert response.json()["detail"] == "request body is larger than the 0 MB upload limit"


def test_upload_without_content_length_is_rejected(client, key, exam):
    client.get("/api/device/command", headers=key)

    def chunked_body():
        yield b"--x\r\n"

    response = client.post(
        f"/api/device/upload/{exam.id}",
        headers={**key, "Content-Type": "multipart/form-data; boundary=x"},
        content=chunked_body(),
    )

    assert response.status_code == 411


def test_size_limit_applies_only_to_uploads(client, key, monkeypatch):
    monkeypatch.setattr(get_settings(), "max_upload_mb", 0)

    assert client.post("/api/device/heartbeat", headers=key, json={"wifi_rssi": -50}).status_code == 200


def test_result_that_cannot_be_stored_marks_exam_failed(client, db, key, exam, monkeypatch):
    """A model answer that does not fit the table must not leave the exam stuck in 'uploaded'."""
    from app.services.analyzer import AnalysisResult

    class TooChattyAnalyzer:
        name, version = "chatty", "1"

        def analyze(self, data):
            return AnalysisResult(quality="good", label="x" * 200, score=0.9)  # label column is 50 chars

    monkeypatch.setattr(analysis.analyzer_module, "get_analyzer", lambda: TooChattyAnalyzer())
    client.get("/api/device/command", headers=key)

    assert upload(client, key, exam.id).status_code == 202

    db.expire_all()
    failed = db.get(Exam, exam.id)
    assert failed.status == ExamStatus.FAILED
    assert failed.failure_reason == "could not store analysis result: DataError"
    assert db.scalar(select(AIResult)) is None
    assert db.scalar(select(Recording).where(Recording.exam_id == exam.id)) is not None, "the recording is kept"
