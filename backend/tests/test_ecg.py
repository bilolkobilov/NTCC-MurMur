"""The ECG recorded with the sound: measuring it (services/ecg.py) and the whole device → doctor path."""

import json
from dataclasses import dataclass

import pytest
from sqlalchemy import select

from app.models import AuditLog, EcgRecording, EcgResult, Exam, ExamStatus, Role
from app.services import ecg, storage
from tests.helpers import login, make_device, make_ecg, make_patient, make_user, make_wav


def measure(data: bytes, *, lead_off: bool = False) -> ecg.EcgAnalysis:
    return ecg.analyze(ecg.EcgInput(data, 2, 250, 6, 2420.0, lead_off))


# --- measuring ---


@pytest.mark.parametrize("heart_rate", [45, 72, 150])
def test_heart_rate_is_measured(heart_rate):
    result = measure(make_ecg(heart_rate=heart_rate))

    assert result.quality == "good" and result.problem is None
    assert result.heart_rate == pytest.approx(heart_rate, abs=2)
    assert result.beats == pytest.approx(20 * heart_rate / 60, abs=2)
    assert result.rr_cv < 0.05  # a perfectly steady synthetic rhythm


def test_the_channel_that_carries_the_heart_is_chosen():
    """Which ADS channel has the ECG depends on the cable and placement (bench, 2026-11-17)."""
    assert measure(make_ecg(ecg_channel=2)).channel == 2
    assert measure(make_ecg(ecg_channel=1)).channel == 1


def test_mains_hum_and_breathing_drift_do_not_hide_the_beats():
    assert measure(make_ecg(hum_mv=2.0)).heart_rate == pytest.approx(72, abs=2)


@pytest.mark.parametrize(
    ("data", "lead_off", "problem"),
    [
        (make_ecg(code=0), False, ecg.FLAT),
        (make_ecg(code=2**23 - 1), False, ecg.SATURATED),
        (make_ecg(ecg_channel=None), False, None),  # only hum and noise: no_beats or noisy
        (make_ecg(ecg_channel=None), True, ecg.LEAD_OFF),
        (make_ecg(r_mv=0.05, noise_mv=0.08), False, None),  # QRS lost in noise
    ],
)
def test_a_poor_ecg_says_cannot_judge_and_gives_no_numbers(data, lead_off, problem):
    result = measure(data, lead_off=lead_off)

    assert result.quality == "bad"
    assert result.problem == problem if problem else result.problem in {ecg.NO_BEATS, ecg.NOISY}
    assert result.heart_rate is None and result.rr_cv is None


def test_lead_off_does_not_hide_a_good_channel():
    assert measure(make_ecg(), lead_off=True).quality == "good"


def test_broken_lengths_are_refused():
    with pytest.raises(ValueError):
        ecg.decode(b"\x00" * 6, 2)


def test_the_strip_is_filtered_millivolts_at_250_hz():
    source = ecg.EcgInput(make_ecg(sample_rate=500), 2, 500, 6, 2420.0, False)
    rate, samples = ecg.display_trace(source, 1)

    assert rate == 250 and len(samples) == 20 * 250
    assert 0.5 < max(samples) < 2.0  # R peaks of ~1 mV survive, the 0.3 mV hum and drift are gone


# --- device → server → doctor ---


@dataclass(frozen=True)
class FakeRhythm:
    label: str = "no_af"
    p_af: float = 0.03
    model_name: str = "ecg-rhythm"
    model_version: str = "test"


class FakeRhythmModel:
    def predict(self, signal_mv, sample_rate):
        assert sample_rate == 250 and len(signal_mv) == 20 * 250
        return FakeRhythm()


@pytest.fixture(autouse=True)
def no_real_rhythm_model(monkeypatch):
    """Tests never load the trained weights (they may or may not be on this machine)."""
    monkeypatch.setattr(ecg, "get_rhythm_model", lambda: None)


@pytest.fixture
def world(client, db):
    doctor = make_user(db, "dr.aziz", Role.DOCTOR)
    device, key = make_device(db, "MM-001", doctor)
    patient = make_patient(db, doctor)
    headers = login(client, "dr.aziz")
    started = client.post(
        "/api/exams", headers=headers, json={"patient_id": patient.id, "device_id": device.id, "point": "MV"}
    )
    exam_id = started.json()["id"]
    client.get("/api/device/command", headers={"X-Device-Key": key})  # now recording
    return {"doctor": headers, "key": {"X-Device-Key": key}, "exam_id": exam_id, "patient": patient}


def upload(client, world, ecg_bytes=None, **meta):
    files = {"audio": ("rec.wav", make_wav(), "audio/wav")}
    if ecg_bytes is not None:
        files["ecg"] = ("rec.ecg", ecg_bytes, "application/octet-stream")
    return client.post(
        f"/api/device/upload/{world['exam_id']}",
        headers=world["key"],
        files=files,
        data={"meta": json.dumps({"motion_detected": False, **meta})},
    )


def test_the_doctor_sees_heart_rate_rhythm_and_the_strip(client, db, world, monkeypatch):
    monkeypatch.setattr(ecg, "get_rhythm_model", lambda: FakeRhythmModel())

    assert upload(client, world, make_ecg(heart_rate=66)).status_code == 202

    exam = client.get(f"/api/exams/{world['exam_id']}", headers=world["doctor"]).json()
    assert exam["status"] == "analyzed" and exam["has_ecg"] is True
    result = exam["ecg_result"]
    assert result["quality"] == "good" and result["heart_rate"] == pytest.approx(66, abs=2)
    assert (result["rhythm_label"], result["rhythm_model_name"], result["rhythm_model_version"]) == (
        "no_af",
        "ecg-rhythm",
        "test",
    )
    strip = client.get(f"/api/exams/{world['exam_id']}/ecg", headers=world["doctor"]).json()
    assert strip["sample_rate"] == 250 and strip["channel"] == 1 and len(strip["samples_mv"]) == 5000
    assert len(strip["r_peaks_s"]) == result["beats"]
    stored = db.scalar(select(EcgRecording))
    assert stored.file_name.endswith(".ecg") and len(stored.file_name) == 36  # random name, never a patient's
    assert db.scalar(select(AuditLog.id).where(AuditLog.action == "exam.ecg")) is not None


def test_a_bad_ecg_never_fails_the_exam(client, world):
    upload(client, world, make_ecg(code=0))

    exam = client.get(f"/api/exams/{world['exam_id']}", headers=world["doctor"]).json()
    assert exam["status"] == "analyzed"
    assert (exam["ecg_result"]["quality"], exam["ecg_result"]["problem"]) == ("bad", "flat")


def test_a_crashing_ecg_analysis_never_fails_the_exam(client, world, monkeypatch):
    def broken(_):
        raise RuntimeError("boom")

    monkeypatch.setattr(ecg, "analyze", broken)
    upload(client, world, make_ecg())

    exam = client.get(f"/api/exams/{world['exam_id']}", headers=world["doctor"]).json()
    assert exam["status"] == "analyzed" and exam["ecg_result"]["problem"] == "error"


def test_an_exam_without_ecg_works_as_before(client, world):
    upload(client, world)

    exam = client.get(f"/api/exams/{world['exam_id']}", headers=world["doctor"]).json()
    assert exam["status"] == "analyzed" and exam["has_ecg"] is False and exam["ecg_result"] is None
    assert client.get(f"/api/exams/{world['exam_id']}/ecg", headers=world["doctor"]).status_code == 404


@pytest.mark.parametrize(
    ("ecg_bytes", "meta"),
    [
        (b"\x00" * 10, {}),  # not whole samples
        (make_ecg(seconds=2), {}),  # too short to judge
        (make_ecg(), {"ecg_channels": 3}),  # the ADS1292R has two
    ],
)
def test_a_broken_ecg_part_is_refused_and_nothing_is_kept(client, db, world, ecg_bytes, meta):
    folder = storage.recording_path("x.ecg").parent
    files_before = set(folder.glob("*"))

    response = upload(client, world, ecg_bytes, **meta)

    assert response.status_code in (400, 422)
    assert db.get(Exam, world["exam_id"]).status == ExamStatus.RECORDING  # the device can retry
    assert db.scalar(select(EcgRecording)) is None
    assert set(folder.glob("*")) == files_before  # neither the WAV nor the ECG was left on disk


def test_only_the_exams_own_doctor_sees_the_ecg(client, db, world):
    upload(client, world, make_ecg())
    make_user(db, "dr.other", Role.DOCTOR)
    make_user(db, "admin", Role.ADMIN)
    path = f"/api/exams/{world['exam_id']}/ecg"

    assert client.get(path, headers=login(client, "dr.other")).status_code == 404
    assert client.get(path, headers=login(client, "admin")).status_code == 403
    assert client.get(path).status_code == 401


def test_patients_never_see_the_ecg(client, db, world):
    upload(client, world, make_ecg())
    client.post(
        f"/api/exams/{world['exam_id']}/review", headers=world["doctor"], json={"note": "Fine.", "agrees_with_ai": None}
    )
    user = make_user(db, "ali", Role.PATIENT)
    world["patient"].user_id = user.id
    db.commit()

    patient = login(client, "ali")
    shown = client.get("/api/me/exams", headers=patient).text + client.get("/api/me", headers=patient).text
    assert "ecg" not in shown.lower() and "rhythm" not in shown.lower()
    assert client.get(f"/api/exams/{world['exam_id']}/ecg", headers=patient).status_code == 403


def test_deleting_the_patient_erases_the_ecg_file(client, db, world):
    upload(client, world, make_ecg())
    ecg_file = storage.recording_path(db.scalar(select(EcgRecording.file_name)))
    assert ecg_file.exists()

    name = world["patient"].full_name
    deleted = client.request(
        "DELETE", f"/api/patients/{world['patient'].id}", headers=world["doctor"], json={"confirm_name": name}
    )

    assert deleted.status_code == 204, deleted.text
    assert not ecg_file.exists()
    assert db.scalar(select(EcgResult)) is None and db.scalar(select(EcgRecording)) is None
