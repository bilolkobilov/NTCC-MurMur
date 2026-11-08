"""The real analyzer (CardioPHON encoder + our murmur head). Needs the optional `ai` group; skipped without it.
No downloaded model files are needed: the tests build small model folders with random weights."""

import json
import math
import struct
import wave

import pytest

from app.config import get_settings
from app.services import analyzer

torch = pytest.importorskip("torch")
cardiophon = pytest.importorskip("app.services.ai.cardiophon")


def write_wav(path, seconds=12.0, rate=4000, hz=60.0):
    samples = [int(8000 * math.sin(2 * math.pi * hz * i / rate)) for i in range(int(seconds * rate))]
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(struct.pack(f"<{len(samples)}h", *samples))
    return path


def model_dir(tmp_path, winner: str):
    """A model folder whose head always answers `winner` (random encoder, last-layer bias decides)."""
    folder = tmp_path / "models" / "cardiophon"
    folder.mkdir(parents=True)
    torch.manual_seed(0)
    torch.save(cardiophon.AudioNTT2022().state_dict(), folder / cardiophon.WEIGHTS_FILE)
    head = cardiophon.murmur_head()
    with torch.no_grad():
        head[-1].weight.zero_()
        head[-1].bias.copy_(torch.tensor([5.0 if c == winner else 0.0 for c in cardiophon.CLASSES]))
    torch.save(head.state_dict(), folder / cardiophon.HEAD_FILE)
    (folder / "murmur_head.json").write_text(json.dumps({"model_version": "9.9.9"}))
    return tmp_path / "models"


def run(models, wav):
    model = cardiophon.CardiophonAnalyzer(models)
    return model, model.analyze(
        analyzer.AnalysisInput(wav_path=wav, sample_rate=4000, duration_s=12, motion_detected=False)
    )


@pytest.mark.parametrize(
    ("winner", "quality", "label"),
    [("present", "good", "murmur"), ("absent", "good", "absent"), ("unknown", "bad", "unknown")],
)
def test_answers_use_the_vocabulary_the_website_understands(tmp_path, winner, quality, label):
    model, result = run(model_dir(tmp_path, winner), write_wav(tmp_path / "a.wav"))

    assert (result.quality, result.label) == (quality, label)
    assert analyzer.gave_answer(result.quality, result.label) is (winner != "unknown")
    assert (result.score > 0.9) is (winner == "present")  # the score is P(murmur): high only for "present"
    assert (model.name, model.version) == ("cardiophon-murmur", "9.9.9")


def test_other_sample_rates_are_resampled_to_4_khz(tmp_path):
    _, result = run(model_dir(tmp_path, "absent"), write_wav(tmp_path / "a.wav", rate=16000))
    assert result.label == "absent"

    tone = torch.sin(2 * math.pi * 100 * torch.arange(16000) / 16000)  # 1 s of 100 Hz at 16 kHz
    down = cardiophon.resample(tone, 16000)
    assert len(down) == 4000
    assert int(torch.fft.rfft(down).abs().argmax()) == 100  # still 100 Hz (1 Hz per bin for 1 s)


def test_log_mel_has_the_shape_the_encoder_was_trained_on():
    image = cardiophon.log_mel(torch.zeros(4000 * 2) + 0.01)
    assert image.shape == (64, 51)  # 64 mel bands, one frame per 160 samples (+1, centred)


def test_missing_model_files_fall_back_to_the_dummy(tmp_path, caplog):
    settings = get_settings().model_copy(update={"ai_model": "cardiophon", "ai_model_dir": tmp_path / "nothing"})

    built = analyzer._build(settings)

    assert isinstance(built, analyzer.DummyAnalyzer)
    assert "using the dummy analyzer" in caplog.text


def test_ai_model_setting_picks_the_analyzer(tmp_path):
    settings = get_settings().model_copy(
        update={"ai_model": "cardiophon", "ai_model_dir": model_dir(tmp_path, "absent")}
    )
    assert isinstance(analyzer._build(settings), cardiophon.CardiophonAnalyzer)
    assert isinstance(analyzer._build(get_settings().model_copy(update={"ai_model": "dummy"})), analyzer.DummyAnalyzer)


@pytest.mark.parametrize(("threshold", "label"), [(0.3, "murmur"), (0.5, "absent")])
def test_present_absent_head_with_windows_and_a_screening_threshold(tmp_path, threshold, label):
    """P(present) = 0.4: a screening threshold of 0.3 says "murmur", 0.5 says "absent"."""
    folder = tmp_path / "models" / "cardiophon"
    folder.mkdir(parents=True)
    torch.save(cardiophon.AudioNTT2022().state_dict(), folder / cardiophon.WEIGHTS_FILE)
    head = cardiophon.murmur_head("linear", 2)
    with torch.no_grad():
        head[-1].weight.zero_()
        head[-1].bias.copy_(torch.log(torch.tensor([0.4, 0.6])))
    torch.save(head.state_dict(), folder / cardiophon.HEAD_FILE)
    meta = {"model_version": "1.1.0", "classes": ["present", "absent"], "arch": "linear", "window_s": 4.0}
    (folder / "murmur_head.json").write_text(json.dumps({**meta, "threshold": threshold}))

    _, result = run(tmp_path / "models", write_wav(tmp_path / "a.wav"))

    assert result.label == label and result.quality == "good"
    assert result.score == pytest.approx(0.4, abs=1e-4)  # always P(murmur), whatever the answer


def test_windows_cover_the_whole_recording():
    encoder = cardiophon.Encoder.__new__(cardiophon.Encoder)
    encoder.model = cardiophon.AudioNTT2022().eval()
    rows = encoder.embed_windows(torch.randn(4000 * 12) * 0.01, 4.0, 2.0)
    assert rows.shape == (5, 3072)  # 0–4, 2–6, 4–8, 6–10, 8–12 s
    assert encoder.embed_windows(torch.randn(4000 * 3) * 0.01, 4.0, 2.0).shape == (1, 3072)  # shorter: one row
