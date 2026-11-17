"""Measure the finished ECG rhythm model ONCE on the CinC 2017 test records and the PTB-XL external set;
write docs/specs/ecg-ai-results.md.

Run from backend/ after train.py:  uv run python -X utf8 -I ../scripts/ai/ecg/evaluate.py
The model is loaded with `ecg_rhythm.load()` and every recording goes through `ecg_rhythm.preprocess()` + `decide()`,
i.e. exactly the server's path: the first 20 s, resampled to 250 Hz.

Definitions (product = "AF suspected" yes / no; "unclear" when the "noisy" class wins):
- AF sensitivity = AF recordings answered "af_suspected" / ALL AF recordings ("unclear" counts as missed).
- Specificity = non-AF recordings (CinC: normal + other; PTB-XL: sinus) answered "no_af" / those that got an answer.
- 95 % CIs: 2000 bootstrap resamples of the recordings (percentile method, seed 2017).
"""

import json
import sys
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np  # noqa: E402
from data import (  # noqa: E402
    CLASSES,
    MODEL_DIR,
    PTBXL_DIR,
    RESULTS,
    SPLIT_DIR,
    cinc_labels,
    ptbxl_records,
    read_cinc,
    read_ids,
    read_wfdb16,
)
from train import sha  # noqa: E402

from app.services.ai import ecg_rhythm as er  # noqa: E402

BOOT = 2000
SEED = 2017
# Checked by hand on 2026-11-17 (model 1.0.0); the recording stays outside the repository (volunteer data).
REAL_DEVICE_CHECK = (
    "One 32 s ADS1292R recording of a healthy volunteer (CH1, first 2 s dropped, ~68 bpm) gave 'no AF' "
    "(P(AF) 0.001) on its first 20 s, its last 20 s and with inverted polarity."
)
NAMES = {"normal": "Normal", "af": "AF", "other": "Other", "noisy": "Noisy"}


def pct(x: float) -> str:
    return f"{100 * x:.1f} %"


def ci(values: np.ndarray) -> str:
    lo, hi = np.nanpercentile(values, [2.5, 97.5])
    return f"{pct(lo)} – {pct(hi)}"


def af_screen(labels: list[str], is_af: np.ndarray, is_neg: np.ndarray) -> tuple[float, float]:
    flagged = np.array([lb == "af_suspected" for lb in labels])
    answered = np.array([lb != "unclear" for lb in labels])
    sens = float(flagged[is_af].mean()) if is_af.any() else float("nan")
    neg = is_neg & answered
    spec = float((~flagged[neg]).mean()) if neg.any() else float("nan")
    return sens, spec


def bootstrap(labels: list[str], is_af: np.ndarray, is_neg: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(SEED)
    arr = np.array(labels)
    sens, spec = np.empty(BOOT), np.empty(BOOT)
    for b in range(BOOT):
        idx = rng.integers(0, len(arr), len(arr))
        sens[b], spec[b] = af_screen(list(arr[idx]), is_af[idx], is_neg[idx])
    return sens, spec


def class_table(truth: np.ndarray, pred: np.ndarray) -> tuple[list[str], np.ndarray]:
    rows = ["| Class | n | Sensitivity | Specificity | PPV | F1 |", "| --- | --- | --- | --- | --- | --- |"]
    f1 = np.zeros(len(CLASSES))
    for c, name in enumerate(CLASSES):
        tp = np.sum((pred == c) & (truth == c))
        fn = np.sum((pred != c) & (truth == c))
        fp = np.sum((pred == c) & (truth != c))
        tn = np.sum((pred != c) & (truth != c))
        ppv = tp / (tp + fp) if tp + fp else float("nan")
        f1[c] = 2 * tp / (2 * tp + fp + fn) if tp + fp + fn else 0.0
        rows.append(
            f"| {NAMES[name]} | {tp + fn} | {pct(tp / (tp + fn))} | {pct(tn / (tn + fp))} | {pct(ppv)} | {f1[c]:.3f} |"
        )
    return rows, f1


def main() -> None:
    model = er.load(MODEL_DIR)
    if model is None:
        raise SystemExit(f"no model in {MODEL_DIR}; run train.py first")
    meta = json.loads((MODEL_DIR / er.META_FILE).read_text(encoding="utf-8"))
    for name, digest in meta["training"]["split_sha256"].items():
        assert sha(SPLIT_DIR / name) == digest, f"split/{name} changed since training"

    # --- CinC 2017 held-out test records ---
    labels = cinc_labels()
    test_ids = read_ids("test.txt")
    truth = np.array([CLASSES.index(labels[r]) for r in test_ids])
    windows = np.stack([er.preprocess(*read_cinc(r)) for r in test_ids])
    probs = model.probabilities(windows)
    pred = probs.argmax(1)
    product = [er.decide(p, model.threshold) for p in probs]
    rows, f1 = class_table(truth, pred)
    is_af = truth == CLASSES.index("af")
    is_neg = np.isin(truth, [CLASSES.index("normal"), CLASSES.index("other")])
    sens, spec = af_screen(product, is_af, is_neg)
    b_sens, b_spec = bootstrap(product, is_af, is_neg)

    # --- PTB-XL fold 10, lead II, AF vs clean sinus (other patients, other hospital, 10 s 12-lead ECGs) ---
    ptb = ptbxl_records()
    ptb_windows = np.stack([er.preprocess(*read_wfdb16(PTBXL_DIR / rel, "II")) for _, rel, _ in ptb])
    ptb_probs = model.probabilities(ptb_windows)
    ptb_product = [er.decide(p, model.threshold) for p in ptb_probs]
    ptb_af = np.array([lb == "af" for _, _, lb in ptb])
    p_sens, p_spec = af_screen(ptb_product, ptb_af, ~ptb_af)
    pb_sens, pb_spec = bootstrap(ptb_product, ptb_af, ~ptb_af)
    ptb_unclear = {g: float(np.mean([ptb_product[i] == "unclear" for i in np.flatnonzero(m)])) for g, m in
                   (("af", ptb_af), ("sinus", ~ptb_af))}  # fmt: skip
    ptb_argmax = np.bincount(ptb_probs.argmax(1)[~ptb_af], minlength=4)
    ptb_answered = np.array([lb != "unclear" for lb in ptb_product])
    p_sens_answered = float(np.mean([ptb_product[i] == "af_suspected" for i in np.flatnonzero(ptb_af & ptb_answered)]))
    ptb_missed = {lb: sum(ptb_product[i] == lb for i in np.flatnonzero(ptb_af)) for lb in ("unclear", "no_af")}
    _, spec_normal = af_screen(product, is_af, truth == CLASSES.index("normal"))
    _, spec_other = af_screen(product, is_af, truth == CLASSES.index("other"))

    product_by_class = {
        name: [sum(product[i] == lb for i in np.flatnonzero(truth == c)) for lb in er.LABELS]
        for c, name in enumerate(CLASSES)
    }
    cand = meta["candidates"]
    val = meta["validation"]
    tr = meta["training"]
    lines = [
        "# ECG rhythm model: results",
        "",
        f"Generated {datetime.now(UTC).date()} by `scripts/ai/ecg/evaluate.py`, run once on the finished model "
        f"`{meta['model_name']} {meta['model_version']}` (trained {meta['trained_at']}). Research prototype and "
        "screening aid, **not a medical device**. Reproduce: `scripts/ai/ecg/README.md`.",
        "",
        "## Data",
        "",
        "- **Training / validation / test:** PhysioNet/CinC Challenge 2017 training set (8528 single-lead AliveCor "
        "recordings, 300 Hz, 9–61 s; ODC-By 1.0), final labels `REFERENCE-v3.csv`: normal, AF, other rhythm, noisy.",
        f"- **Split:** made once, 80 / 10 / 10 stratified by class, seed 2017 ({tr['train_records']} / "
        f"{tr['val_records']} / {len(test_ids)} records; lists in `scripts/ai/ecg/split/`). **CinC 2017 publishes no "
        "patient IDs, so this is a record-level split**: one person may have records in both training and test, "
        "which can make the CinC test numbers optimistic.",
        f"- **External check (patient-level):** PTB-XL 1.0.3 (CC BY 4.0), strat_fold 10 only (PTB-XL keeps each "
        f"patient in one fold), lead II at 500 Hz, 10 s each: all {int(ptb_af.sum())} AF recordings and "
        f"{int((~ptb_af).sum())} clean sinus (NORM + SR) recordings sampled with seed 2017 "
        "(`split/ptbxl_fold10.csv`). Never used for training or any choice.",
        "",
        "## Model and training",
        "",
        "- **Input contract:** 1-D signal in mV, resampled to 250 Hz, first 20 s (shorter is zero-padded), band-pass "
        "0.5–40 Hz by FFT mask (also removes 50 / 60 Hz), centred on the median and divided by the 99th percentile of "
        "|x|. CinC records are resampled 300 → 250 Hz; PTB-XL 500 → 250 Hz and padded from 10 s to 20 s.",
        f"- **Network:** 1-D ResNet `{meta['chosen']}` ({meta['params']:,} parameters, weights "
        f"{(MODEL_DIR / er.WEIGHTS_FILE).stat().st_size / 1e6:.2f} MB), 4 outputs, class-weighted cross-entropy, "
        f"AdamW + one-cycle learning rate, {tr['epochs']} epochs, batch {tr['batch']}, random 20 s crops (15 % "
        "shorter crops), augmentation: polarity flip, amplitude ×0.5–2, baseline wander, 50 / 60 Hz hum, noise.",
        "- **Chosen on validation only** (best epoch by validation CinC F1, then the architecture):",
        "",
        "| Candidate | Parameters | Best epoch | Val CinC F1 (N/A/O) | Val macro F1 (4 classes) | Train time |",
        "| --- | --- | --- | --- | --- | --- |",
        *[
            f"| `{n}`{' (chosen)' if n == meta['chosen'] else ''} | {c['params']:,} | {c['best_epoch']} | "
            f"{c['val_cinc_f1']:.3f} | {c['val_macro_f1']:.3f} | {c['train_seconds'] / 60:.0f} min |"
            for n, c in cand.items()
        ],
        "",
        f"Total training time {sum(c['train_seconds'] for c in cand.values()) / 60:.0f} min on the laptop CPU "
        f"({tr['threads']} threads).",
        f"- **AF threshold {model.threshold:.4f}:** the highest P(AF) at which validation AF sensitivity stays ≥ "
        f"{pct(val['target_sensitivity'])} (capped at {val['max_threshold']}). On validation: AF sensitivity "
        f"{pct(val['af_sensitivity'])}, specificity {pct(val['af_specificity'])}. Validation has only 76 AF records, "
        "so this choice is itself uncertain by several percentage points.",
        "",
        "## CinC 2017 test set (held-out records, run once)",
        "",
        "Four-class result (most likely class), first 20 s of each record:",
        "",
        "| True \\ Predicted | " + " | ".join(NAMES[c] for c in CLASSES) + " |",
        "| --- | --- | --- | --- | --- |",
        *[
            f"| {NAMES[name]} | " + " | ".join(str(int(np.sum((truth == c) & (pred == k)))) for k in range(4)) + " |"
            for c, name in enumerate(CLASSES)
        ],
        "",
        *rows,
        "",
        f"- **Macro F1 (4 classes): {f1.mean():.3f}**; **CinC F1 (mean of normal / AF / other, the challenge "
        f"score): {f1[:3].mean():.3f}**.",
        "",
        "Product answer (what a doctor would see):",
        "",
        "| True class | AF suspected | No AF | Unclear |",
        "| --- | --- | --- | --- |",
        *[f"| {NAMES[n]} | " + " | ".join(str(v) for v in counts) + " |" for n, counts in product_by_class.items()],
        "",
        f"- **AF sensitivity {pct(sens)}** (95 % CI {ci(b_sens)}), **specificity {pct(spec)}** (95 % CI "
        f"{ci(b_spec)}) over normal + other recordings that got an answer.",
        f"- Specificity on normal recordings alone: {pct(spec_normal)}; on 'other rhythm' alone: {pct(spec_other)}. "
        "Most false AF alarms come from other arrhythmias (irregular beats), not from normal hearts.",
        f"- Test AF sensitivity is higher than on validation ({pct(val['af_sensitivity'])}) with the same threshold. "
        "With 76 AF records per set this gap is within chance, and the record-level split may also help the test "
        "set; expect about the validation level, or lower, on new people.",
        "",
        "## PTB-XL external check (AF vs sinus, lead II, other patients)",
        "",
        f"- **AF sensitivity {pct(p_sens)}** (95 % CI {ci(pb_sens)}), **specificity {pct(p_spec)}** (95 % CI "
        f"{ci(pb_spec)}).",
        f"- Unclear: {pct(ptb_unclear['af'])} of AF, {pct(ptb_unclear['sinus'])} of sinus recordings. Sinus "
        f"recordings' most likely class: normal {ptb_argmax[0]}, AF {ptb_argmax[1]}, other {ptb_argmax[2]}, noisy "
        f"{ptb_argmax[3]}.",
        f"- AF sensitivity among AF recordings that got an answer: {pct(p_sens_answered)}. Missed AF: "
        f"{ptb_missed['unclear']} 'unclear' (the model called the recording 'noisy'), {ptb_missed['no_af']} 'no AF'.",
        "",
        "## Limitations",
        "",
        "- **Lead shift.** CinC 2017 is a hand-held AliveCor device (roughly lead I, fingers); PTB-XL is a clinical "
        "12-lead ECG (we use lead II); our ADS1292R chest lead is lead-II-like but not identical. Waveform shape, "
        "amplitude and noise differ between all three.",
        "- **No patient IDs in CinC 2017**: the CinC test is record-level; PTB-XL fold 10 is the only "
        "patient-level check, and only for AF vs clean sinus (no 'other rhythm' or noisy cases there).",
        "- **PTB-XL records are 10 s**, padded to 20 s; our exams are 20 s. Fewer beats make AF harder to see.",
        f"- **Our device is not validated.** {REAL_DEVICE_CHECK} There is no AF recording from our hardware. "
        "Numbers here say nothing yet about accuracy on MurMur recordings.",
        "- **Small AF counts** (76 validation, 76 test, " + str(int(ptb_af.sum())) + " PTB-XL): read the "
        "confidence intervals, not just the point estimates.",
        "- 'Other rhythm' is a broad mix (ectopy, flutter, blocks…); the product does not show it.",
        "",
        "## Citations",
        "",
        "- G. D. Clifford et al., AF Classification from a Short Single Lead ECG Recording: the PhysioNet/Computing in "
        "Cardiology Challenge 2017. Computing in Cardiology 44 (2017).",
        "- P. Wagner et al., PTB-XL, a large publicly available electrocardiography dataset. Scientific Data 7, 154 "
        "(2020); PTB-XL 1.0.3 on PhysioNet.",
        "- A. L. Goldberger et al., PhysioBank, PhysioToolkit, and PhysioNet. Circulation 101(23) (2000).",
        "",
    ]
    RESULTS.write_text("\n".join(lines), encoding="utf-8")
    print(f"CinC test: AF sens {pct(sens)} [{ci(b_sens)}], spec {pct(spec)} [{ci(b_spec)}], "
          f"macro F1 {f1.mean():.3f}, CinC F1 {f1[:3].mean():.3f}")  # fmt: skip
    print(f"PTB-XL: AF sens {pct(p_sens)} [{ci(pb_sens)}], spec {pct(p_spec)} [{ci(pb_spec)}]")
    print(f"wrote {RESULTS}")


if __name__ == "__main__":
    main()
