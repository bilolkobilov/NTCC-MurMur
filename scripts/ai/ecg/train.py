"""Train the ECG rhythm model on the CinC 2017 training records; choose everything on the validation records only.

Run from backend/ (after download.py and split.py):  uv run python -I ../scripts/ai/ecg/train.py
Writes models/ecg/ecg_rhythm.pt + ecg_rhythm.json (version, threshold, architecture, validation numbers).

- Input: random 20 s crops of the records resampled 300 → 250 Hz (15 % of crops are 9–20 s and zero-padded, so a
  short recording looks familiar), augmented in mV (polarity flip, amplitude scale, baseline wander, 50 Hz hum,
  Gaussian noise), then cleaned by the SAME `ecg_rhythm.clean()` the server uses.
- Validation: the first 20 s of each validation record through `ecg_rhythm.preprocess()` — exactly what the server
  does with an exam. Every candidate architecture is trained for EPOCHS; the epoch and the architecture with the best
  validation CinC F1 (mean F1 of normal / AF / other) are kept.
- AF threshold: the highest P(af) at which validation AF sensitivity is still ≥ 90 % ("unclear" counts as missed),
  never above 0.5 (owner: a screening aid should rather find more).
"""

import hashlib
import json
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np  # noqa: E402
import torch  # noqa: E402
import torch.nn.functional as F  # noqa: E402
from data import CINC_DIR, CLASSES, MODEL_DIR, SPLIT_DIR, cinc_labels, read_cinc, read_ids  # noqa: E402

from app.services.ai import ecg_rhythm as er  # noqa: E402

MODEL_VERSION = "1.0.0"  # bump on every retrain; stored with every result
SEED = 2017
EPOCHS = 40
BATCH = 64
LR = 2e-3
THREADS = 8  # measured: 8 threads train faster than 16 on the owner's laptop
TARGET_SENSITIVITY = 0.90
MAX_THRESHOLD = 0.5
CANDIDATES = {  # name → RhythmNet arguments
    "resnet-4x2": {"widths": [32, 64, 96, 128], "blocks": 2, "kernel": 7},
    "resnet-5x1": {"widths": [32, 48, 64, 96, 128], "blocks": 1, "kernel": 7},
}
SHORT_CROP_P = 0.15
MIN_CROP_S = 9.0


def load_records(ids: list[str]) -> list[np.ndarray]:
    out = []
    for record in ids:
        signal, rate = read_cinc(record)
        out.append(er.resample(signal, rate).astype(np.float32))
    return out


def augment(x: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """A raw 250 Hz window in mV → a plausibly different recording of the same rhythm."""
    t = np.arange(len(x)) / er.SAMPLE_RATE
    x = x.astype(np.float64) * rng.uniform(0.5, 2.0)
    if rng.random() < 0.5:
        x = -x  # electrodes swapped
    if rng.random() < 0.5:  # baseline wander: breathing / movement
        for _ in range(rng.integers(1, 4)):
            x = x + rng.uniform(0.05, 0.6) * np.sin(2 * np.pi * rng.uniform(0.05, 0.5) * t + rng.uniform(0, 6.3))
    if rng.random() < 0.5:  # mains hum, as on the ADS1292R
        x = x + rng.uniform(0.02, 1.0) * np.sin(2 * np.pi * rng.choice([50.0, 60.0]) * t + rng.uniform(0, 6.3))
    if rng.random() < 0.5:
        x = x + rng.normal(0, rng.uniform(0.005, 0.08), len(x))
    return x


def random_window(x: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    n = er.N_SAMPLES
    if rng.random() < SHORT_CROP_P:
        n = int(rng.uniform(MIN_CROP_S, er.WINDOW_S) * er.SAMPLE_RATE)
    if len(x) <= n:
        return x
    start = rng.integers(0, len(x) - n + 1)
    return x[start : start + n]


def class_f1(truth: np.ndarray, pred: np.ndarray) -> np.ndarray:
    f1 = np.zeros(len(CLASSES))
    for c in range(len(CLASSES)):
        tp = np.sum((pred == c) & (truth == c))
        denom = np.sum(pred == c) + np.sum(truth == c)
        f1[c] = 2 * tp / denom if denom else 0.0
    return f1


def af_threshold(probs: np.ndarray, truth: np.ndarray) -> tuple[float, float, float]:
    """Highest threshold with AF sensitivity ≥ target (capped). Returns (threshold, sensitivity, specificity)."""
    af, noisy = CLASSES.index("af"), CLASSES.index("noisy")
    answered = probs.argmax(1) != noisy
    p_af = probs[:, af]
    is_af = truth == af
    best = min(float(p_af[is_af & answered].min()) if (is_af & answered).any() else 0.0, MAX_THRESHOLD)
    for t in sorted(set(p_af[is_af & answered].tolist()), reverse=True):
        if np.mean(answered[is_af] & (p_af[is_af] >= t)) >= TARGET_SENSITIVITY:
            best = min(t, MAX_THRESHOLD)
            break
    flagged = answered & (p_af >= best)
    non_af = np.isin(truth, [CLASSES.index("normal"), CLASSES.index("other")]) & answered
    return best, float(np.mean(flagged[is_af])), float(np.mean(~flagged[non_af]))


@torch.inference_mode()
def predict(net: er.RhythmNet, windows: np.ndarray) -> np.ndarray:
    net.eval()
    return torch.cat([net(torch.from_numpy(windows[i : i + 256])).softmax(1) for i in range(0, len(windows), 256)])


def train_one(
    name: str,
    arch: dict,
    train_x: list[np.ndarray],
    train_y: np.ndarray,
    val_windows: np.ndarray,
    val_y: np.ndarray,
) -> dict:
    torch.manual_seed(SEED)
    rng = np.random.default_rng(SEED)
    net = er.RhythmNet(widths=tuple(arch["widths"]), blocks=arch["blocks"], kernel=arch["kernel"])
    counts = np.bincount(train_y, minlength=len(CLASSES))
    weights = torch.tensor(len(train_y) / (len(CLASSES) * counts), dtype=torch.float32)
    steps = EPOCHS * ((len(train_x) + BATCH - 1) // BATCH)
    opt = torch.optim.AdamW(net.parameters(), lr=LR, weight_decay=1e-3)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=LR, total_steps=steps, pct_start=0.15)
    best: dict = {"cinc_f1": -1.0}
    started = time.time()
    for epoch in range(1, EPOCHS + 1):
        net.train()
        order = rng.permutation(len(train_x))
        total = 0.0
        for i in range(0, len(order), BATCH):
            idx = order[i : i + BATCH]
            xb = np.stack([er.clean(augment(random_window(train_x[j], rng), rng)) for j in idx])
            loss = F.cross_entropy(net(torch.from_numpy(xb)), torch.from_numpy(train_y[idx]), weight=weights)
            opt.zero_grad()
            loss.backward()
            opt.step()
            sched.step()
            total += loss.item() * len(idx)
        probs = predict(net, val_windows).numpy()
        f1 = class_f1(val_y, probs.argmax(1))
        cinc_f1 = float(f1[:3].mean())
        print(
            f"{name} epoch {epoch:2d} loss {total / len(order):.3f} val F1 N/A/O/~ "
            f"{' '.join(f'{v:.3f}' for v in f1)} CinC F1 {cinc_f1:.3f}  {time.time() - started:.0f}s",
            flush=True,
        )
        if cinc_f1 > best["cinc_f1"]:
            best = {
                "cinc_f1": cinc_f1,
                "macro_f1": float(f1.mean()),
                "epoch": epoch,
                "state": {k: v.clone() for k, v in net.state_dict().items()},
                "probs": probs,
            }
    best["seconds"] = time.time() - started
    best["params"] = sum(p.numel() for p in net.parameters())
    return best


def sha(path: Path) -> str:
    """SHA-256 of the file with LF line endings, so a Windows (CRLF) and a Git (LF) copy give the same digest."""
    return hashlib.sha256(path.read_bytes().replace(b"\r\n", b"\n")).hexdigest()


def main() -> None:
    torch.set_num_threads(THREADS)
    labels = cinc_labels()
    train_ids, val_ids = read_ids("train.txt"), read_ids("val.txt")
    assert not set(train_ids) & set(val_ids) and not set(read_ids("test.txt")) & (set(train_ids) | set(val_ids))
    loading = time.time()
    train_x = load_records(train_ids)
    train_y = np.array([CLASSES.index(labels[r]) for r in train_ids])
    val_y = np.array([CLASSES.index(labels[r]) for r in val_ids])
    val_windows = np.stack([er.preprocess(*read_cinc(r)) for r in val_ids])
    print(f"loaded {len(train_x)} train / {len(val_ids)} val records in {time.time() - loading:.0f}s", flush=True)

    results = {name: train_one(name, arch, train_x, train_y, val_windows, val_y) for name, arch in CANDIDATES.items()}
    chosen = max(results, key=lambda n: results[n]["cinc_f1"])
    best = results[chosen]
    threshold, sens, spec = af_threshold(best["probs"], val_y)
    noisy = CLASSES.index("noisy")
    print(f"chosen {chosen} (epoch {best['epoch']}), threshold {threshold:.4f}: val AF sens {sens:.3f} spec {spec:.3f}")

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    torch.save(best["state"], MODEL_DIR / er.WEIGHTS_FILE)
    meta = {
        "model_name": er.MODEL_NAME,
        "model_version": MODEL_VERSION,
        "trained_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "classes": list(CLASSES),
        "threshold": threshold,
        "arch": CANDIDATES[chosen] | {"name": chosen},
        "params": best["params"],
        "input": {"sample_rate": er.SAMPLE_RATE, "window_s": er.WINDOW_S, "unit": "mV"},
        "training": {
            "data": "PhysioNet/CinC Challenge 2017 training set, labels REFERENCE-v3.csv",
            "seed": SEED,
            "epochs": EPOCHS,
            "batch": BATCH,
            "lr": LR,
            "threads": THREADS,
            "train_records": len(train_ids),
            "val_records": len(val_ids),
            "split_sha256": {n: sha(SPLIT_DIR / n) for n in ("train.txt", "val.txt", "test.txt")},
            "labels_sha256": sha(CINC_DIR / "REFERENCE-v3.csv"),
        },
        "candidates": {
            n: {
                "params": r["params"],
                "best_epoch": r["epoch"],
                "val_cinc_f1": round(r["cinc_f1"], 4),
                "val_macro_f1": round(r["macro_f1"], 4),
                "train_seconds": round(r["seconds"]),
            }
            for n, r in results.items()
        },
        "chosen": chosen,
        "validation": {
            "af_sensitivity": round(sens, 4),
            "af_specificity": round(spec, 4),
            "target_sensitivity": TARGET_SENSITIVITY,
            "max_threshold": MAX_THRESHOLD,
            "unclear_rate": round(float(np.mean(best["probs"].argmax(1) == noisy)), 4),
        },
    }
    (MODEL_DIR / er.META_FILE).write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    size = (MODEL_DIR / er.WEIGHTS_FILE).stat().st_size
    print(f"wrote {MODEL_DIR / er.WEIGHTS_FILE} ({size} bytes) and {er.META_FILE}")


if __name__ == "__main__":
    if "--smoke" in sys.argv:  # a quick check of the whole pipeline on 300 records; writes to models/ecg/smoke/
        EPOCHS = 1
        CANDIDATES = {"resnet-5x1": CANDIDATES["resnet-5x1"]}
        read_ids_full = read_ids

        def read_ids(name: str) -> list[str]:  # noqa: F811
            return read_ids_full(name)[:300]

        MODEL_DIR = MODEL_DIR / "smoke"
    main()
