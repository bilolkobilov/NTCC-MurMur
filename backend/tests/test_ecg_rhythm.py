"""ECG rhythm model (app/services/ai/ecg_rhythm.py): preprocessing and the decision, without the real weights."""

import json

import numpy as np
import pytest
import torch

from app.services.ai import ecg_rhythm as er


def synthetic_ecg(rate: int, seconds: float, bpm: float = 72.0) -> np.ndarray:
    """Narrow 1 mV spikes at a steady heart rate on a small offset (enough to exercise the filters)."""
    t = np.arange(int(rate * seconds)) / rate
    beats = np.arange(0.3, seconds, 60.0 / bpm)
    return 0.2 + sum(np.exp(-(((t - b) / 0.012) ** 2)) for b in beats)


@pytest.mark.parametrize("rate", [250, 300, 500, 128])
def test_any_rate_becomes_20_s_at_250_hz(rate):
    x = er.preprocess(synthetic_ecg(rate, 30), rate)
    assert x.shape == (5000,) and x.dtype == np.float32
    assert np.abs(x[-100:]).max() > 0  # 30 s input fills the whole 20 s window


def test_resample_300_to_250_keeps_duration_and_beats():
    x300 = synthetic_ecg(300, 20)
    x250 = er.resample(x300, 300)
    assert len(x250) == 5000
    first300 = np.argmax(x300[: int(0.7 * 300)]) / 300  # the first beat (0.3 s)
    first250 = np.argmax(x250[: int(0.7 * 250)]) / 250
    assert abs(first300 - first250) < 0.005  # the same beat lands at the same time
    assert abs(x250.max() - x300.max()) < 0.1


def test_short_input_is_zero_padded_at_the_end():
    x = er.preprocess(synthetic_ecg(250, 9), 250)
    assert x.shape == (5000,)
    assert np.all(x[9 * 250 :] == 0) and np.abs(x[: 9 * 250]).max() > 0


def test_long_input_keeps_the_first_20_s():
    signal = np.concatenate([synthetic_ecg(250, 20), np.zeros(250 * 10)])
    assert np.array_equal(er.preprocess(signal, 250), er.preprocess(signal[:5000], 250))


def test_bandpass_removes_mains_hum_and_baseline():
    t = np.arange(5000) / 250
    hum = np.sin(2 * np.pi * 50 * t)
    drift = 2.0 * np.sin(2 * np.pi * 0.1 * t)
    # Mains hum is gone; only the first / last ~0.1 s keep a short filter transient (training sees the same).
    assert np.abs(er.bandpass(hum)[25:-25]).max() < 0.05
    assert np.abs(er.bandpass(hum)[125:-125]).max() < 0.01
    assert np.abs(er.bandpass(drift)[500:-500]).max() < 0.1
    tone = np.sin(2 * np.pi * 10 * t)  # inside the ECG band: kept
    assert np.abs(er.bandpass(tone)[500:-500] - tone[500:-500]).max() < 0.02


def test_flat_and_empty_signals_do_not_crash():
    assert np.all(er.preprocess(np.zeros(5000), 250) == 0)
    assert np.all(er.preprocess(np.array([]), 250) == 0)
    assert np.isfinite(er.preprocess(np.full(5000, np.nan), 250)).all()
    with pytest.raises(ValueError):
        er.preprocess(np.zeros(10), 0)


def test_decide_abstains_on_noisy_and_uses_the_threshold():
    assert er.decide(np.array([0.1, 0.2, 0.1, 0.6]), 0.1) == "unclear"
    assert er.decide(np.array([0.6, 0.3, 0.1, 0.0]), 0.25) == "af_suspected"
    assert er.decide(np.array([0.6, 0.3, 0.1, 0.0]), 0.35) == "no_af"


def tiny_model() -> er.RhythmNet:
    torch.manual_seed(0)
    return er.RhythmNet(widths=(8, 8), blocks=1, kernel=3)


def test_tiny_random_model_runs_end_to_end():
    model = er.EcgRhythm(tiny_model(), threshold=0.3, version="test")
    result = model.predict(synthetic_ecg(300, 25), 300)
    assert isinstance(result, er.RhythmResult)
    assert result.label in er.LABELS
    assert 0.0 <= result.p_af <= 1.0
    assert (result.model_name, result.model_version) == ("ecg-rhythm", "test")
    with pytest.raises(AttributeError):
        result.label = "no_af"  # frozen


def test_load_returns_none_without_weights(tmp_path):
    assert er.load(tmp_path) is None
    (tmp_path / er.META_FILE).write_text("{}", encoding="utf-8")
    assert er.load(tmp_path) is None  # metadata alone is not a model


def test_load_round_trip(tmp_path):
    net = tiny_model()
    torch.save(net.state_dict(), tmp_path / er.WEIGHTS_FILE)
    meta = {"model_version": "9.9.9", "threshold": 0.42, "arch": {"widths": [8, 8], "blocks": 1, "kernel": 3}}
    (tmp_path / er.META_FILE).write_text(json.dumps(meta), encoding="utf-8")
    model = er.load(tmp_path)
    assert model is not None and model.threshold == 0.42 and model.version == "9.9.9"
    result = model.predict(synthetic_ecg(250, 20), 250)
    assert result.model_version == "9.9.9" and result.label in er.LABELS
