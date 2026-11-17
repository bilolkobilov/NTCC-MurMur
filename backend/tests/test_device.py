import json
import re

import pytest
from sqlalchemy import select

from app.config import get_settings
from app.models import AIResult, CommandStatus, Device, DeviceCommand, Exam, ExamStatus, Recording, Role
from app.schemas.device import UploadMeta
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
    [
        ("post", "/api/device/heartbeat"),
        ("get", "/api/device/command"),
        ("post", "/api/device/upload/1"),
        ("post", "/api/device/self-test"),
    ],
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

    response = upload(client, key, exam.id, make_wav(seconds=12, sample_rate=4000), {"motion_detected": False})

    assert response.status_code == 202
    assert response.json() == {"exam_id": exam.id, "status": "uploaded"}
    db.expire_all()
    recording = db.scalar(select(Recording).where(Recording.exam_id == exam.id))
    assert re.fullmatch(r"[0-9a-f]{32}\.wav", recording.file_name), "file name must be random, never a patient name"
    assert storage.recording_path(recording.file_name).read_bytes()[:4] == b"RIFF"
    assert recording.sample_rate == 4000
    assert recording.duration_s == pytest.approx(12.0)
    assert recording.motion_detected is False
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
                device_flow.accept_upload(session, device, exam.id, make_wav(), UploadMeta())
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

    response = upload(client, key, exam.id, make_wav(seconds=160))  # ~1.3 MB > 0 MB + overhead (meta, ECG part)

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


def test_stale_command_is_skipped_and_does_not_block_newer_ones(client, db, doctor, key, device_and_key, exam):
    """If an exam stops waiting before the device polls, its command is closed and the next one is delivered."""
    exam.status = ExamStatus.FAILED  # e.g. cancelled by the doctor
    db.commit()
    patient = make_patient(db, doctor, "Second Patient")
    body = {"patient_id": patient.id, "device_id": device_and_key[0].id, "point": "PV"}
    second = client.post("/api/exams", headers=login(client, "dr.aziz"), json=body).json()

    polled = client.get("/api/device/command", headers=key)

    assert polled.status_code == 200
    assert polled.json()["exam_id"] == second["id"]
    stale = db.scalar(select(DeviceCommand).where(DeviceCommand.exam_id == exam.id))
    db.refresh(stale)
    assert stale.status == CommandStatus.DONE
    db.refresh(exam)
    assert exam.status == ExamStatus.FAILED, "a stale exam is left as it was"
    assert client.get("/api/device/command", headers=key).status_code == 204


# --- doctor cancels an exam ---


def test_cancel_waiting_exam_closes_its_command(client, db, key, exam):
    response = client.post(f"/api/exams/{exam.id}/cancel", headers=login(client, "dr.aziz"))

    assert response.status_code == 200
    assert response.json()["status"] == "failed"
    assert response.json()["failure_reason"] == "cancelled by doctor"
    command = db.scalar(select(DeviceCommand).where(DeviceCommand.exam_id == exam.id))
    db.refresh(command)
    assert command.status == CommandStatus.DONE
    assert client.get("/api/device/command", headers=key).status_code == 204


def test_cancel_recording_exam_then_late_upload_gets_409(client, db, key, exam):
    client.get("/api/device/command", headers=key)  # device took it, then e.g. lost Wi-Fi

    assert client.post(f"/api/exams/{exam.id}/cancel", headers=login(client, "dr.aziz")).status_code == 200

    assert upload(client, key, exam.id).status_code == 409
    assert db.scalar(select(Recording)) is None


@pytest.mark.parametrize("status", [ExamStatus.UPLOADED, ExamStatus.ANALYZED, ExamStatus.REVIEWED, ExamStatus.FAILED])
def test_only_waiting_or_recording_exams_can_be_cancelled(client, db, exam, status):
    exam.status = status
    db.commit()

    assert client.post(f"/api/exams/{exam.id}/cancel", headers=login(client, "dr.aziz")).status_code == 409


def test_cannot_cancel_another_doctors_exam(client, db, exam):
    make_user(db, "dr.other", Role.DOCTOR)

    assert client.post(f"/api/exams/{exam.id}/cancel", headers=login(client, "dr.other")).status_code == 404


# --- recording quality rules (run before the analyzer) ---


@pytest.mark.parametrize(
    ("wav", "meta", "reason"),
    [
        (lambda: make_wav(seconds=6), {}, "re-record: too short (6.0 s, need at least 10 s)"),
        (lambda: make_wav(amplitude=100), {}, "re-record: almost silent (is the stethoscope touching the chest?)"),
        (lambda: make_wav(amplitude=40000), {}, "re-record: too loud"),
        (lambda: make_wav(), {"motion_detected": True}, "re-record: movement detected during recording"),
    ],
    ids=["short", "silent", "clipped", "motion"],
)
def test_bad_recording_is_not_analyzed_and_asks_to_re_record(client, db, key, exam, monkeypatch, wav, meta, reason):
    called = []
    monkeypatch.setattr(analysis.analyzer_module, "get_analyzer", lambda: called.append(1))
    client.get("/api/device/command", headers=key)

    assert upload(client, key, exam.id, wav(), meta).status_code == 202

    db.expire_all()
    failed = db.get(Exam, exam.id)
    assert failed.status == ExamStatus.FAILED
    assert failed.failure_reason.startswith(reason), failed.failure_reason
    assert called == [], "the analyzer must not see a bad recording"
    assert db.scalar(select(Recording).where(Recording.exam_id == exam.id)) is not None, "audio kept for the doctor"


def test_several_problems_are_all_reported(client, db, key, exam):
    client.get("/api/device/command", headers=key)

    upload(client, key, exam.id, make_wav(seconds=5, amplitude=50), {"motion_detected": True})

    db.expire_all()
    reason = db.get(Exam, exam.id).failure_reason
    assert "too short" in reason and "almost silent" in reason and "movement" in reason


@pytest.mark.parametrize("width", [1, 2, 3, 4])
def test_quality_reads_8_16_24_32_bit_pcm(tmp_path, width):
    import wave

    from app.services import quality

    full = {1: 127, 2: 32767, 3: 2**23 - 1, 4: 2**31 - 1}[width]
    half = full // 2
    frames = []
    for i in range(4000):
        value = half if i % 2 else -half
        if width == 1:
            frames.append(bytes([value + 128]))
        else:
            frames.append(value.to_bytes(width, "little", signed=True))
    path = tmp_path / "x.wav"
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(width)
        w.setframerate(4000)
        w.writeframes(b"".join(frames))

    stats = quality.measure(path, 1.0)

    assert stats.peak == pytest.approx(0.5, abs=0.01)
    assert stats.clipped_fraction == 0


# --- lock order: polling vs cancel / delete must not deadlock ---


def _in_thread(target):
    import threading

    result: dict = {}

    def run():
        try:
            result["value"] = target()
        except Exception as exc:  # reported by the test
            result["error"] = exc

    thread = threading.Thread(target=run)
    thread.start()
    return thread, result


def test_poll_during_cancel_does_not_deadlock(client, db, doctor, device_and_key, exam, monkeypatch):
    """Cancel holds the exam lock and then closes the command; a poll arriving in between must just wait."""
    import time

    from app.db import SessionLocal
    from app.services import device_flow, exam_flow, exams

    real_mark_failed = exam_flow.mark_failed

    def slow_mark_failed(e, reason):  # runs after cancel took the exam lock, before it touches the command
        time.sleep(0.6)
        real_mark_failed(e, reason)

    monkeypatch.setattr(exam_flow, "mark_failed", slow_mark_failed)

    def cancel():
        with SessionLocal() as session:
            return exams.cancel_exam(session, session.get(type(doctor), doctor.id), exam.id).status

    def poll():
        with SessionLocal() as session:
            device = session.get(Device, device_and_key[0].id)
            return device_flow.take_next_command(session, device)

    cancel_thread, cancel_result = _in_thread(cancel)
    time.sleep(0.2)
    poll_thread, poll_result = _in_thread(poll)
    cancel_thread.join(10)
    poll_thread.join(10)

    assert "error" not in cancel_result, cancel_result
    assert "error" not in poll_result, poll_result
    assert cancel_result["value"] == ExamStatus.FAILED
    assert poll_result["value"] is None, "the cancelled exam's command must not be handed out"


def test_two_simultaneous_polls_get_the_command_once(db, device_and_key, exam):
    import threading

    from app.db import SessionLocal
    from app.services import device_flow

    barrier = threading.Barrier(2)
    results: list = []

    def poll():
        with SessionLocal() as session:
            device = session.get(Device, device_and_key[0].id)
            barrier.wait()
            command = device_flow.take_next_command(session, device)
            results.append(command.exam_id if command else None)

    threads = [threading.Thread(target=poll) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(10)

    assert sorted(results, key=str) == sorted([exam.id, None], key=str)
