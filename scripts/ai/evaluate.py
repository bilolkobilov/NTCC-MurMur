"""Measure the murmur head on the held-out CirCor test patients and write docs/specs/ai-results.md.

Run from backend/ after train_head.py:  uv run --group ai python ../scripts/ai/evaluate.py
Recording level (one exam = one recording). "Answered" = the model said present or absent; "unknown" is shown to the
doctor as "too poor to judge", so it counts as no answer, not as a mistake.
"""

import json
from datetime import UTC, datetime

import circor
import numpy as np
import torch

from app.services.ai import cardiophon

RESULTS = circor.REPO / "docs" / "specs" / "ai-results.md"


def pct(part: int, whole: int) -> str:
    return f"{part / whole:.1%} ({part}/{whole})" if whole else "n/a"


def main() -> None:
    meta = json.loads((circor.OUT / "murmur_head.json").read_text(encoding="utf-8"))
    split = json.loads((circor.OUT / "split.json").read_text(encoding="utf-8"))
    recs = circor.recordings()
    test_patients = set(split["test_patients"])
    test = [r for r in recs if r.patient in test_patients]
    assert test_patients == circor.test_patients(recs), "split changed since training"

    vectors = circor.embeddings(recs)
    head = cardiophon.murmur_head()
    head.load_state_dict(torch.load(circor.OUT / cardiophon.HEAD_FILE, weights_only=True))
    head.eval()
    with torch.inference_mode():
        probs = head(torch.from_numpy(np.stack([vectors[r.file.name] for r in test]))).softmax(1).numpy()
    predicted = [cardiophon.CLASSES[i] for i in probs.argmax(1)]
    truth = [r.label for r in test]

    classes = cardiophon.CLASSES
    matrix = {t: {p: 0 for p in classes} for t in classes}
    for t, p in zip(truth, predicted, strict=True):
        matrix[t][p] += 1

    present = [p for t, p in zip(truth, predicted, strict=True) if t == "present"]
    absent = [p for t, p in zip(truth, predicted, strict=True) if t == "absent"]
    answered = [(t, p) for t, p in zip(truth, predicted, strict=True) if t != "unknown" and p != "unknown"]
    rows = [
        ("Sensitivity (murmur found when there is one)", pct(present.count("present"), len(present))),
        ("Specificity (no murmur said when there is none)", pct(absent.count("absent"), len(absent))),
        ("Accuracy when it answers (true present/absent only)", pct(sum(t == p for t, p in answered), len(answered))),
        (
            'No answer ("too poor to judge") on real present/absent',
            pct(present.count("unknown") + absent.count("unknown"), len(present) + len(absent)),
        ),
        (
            "Unknown recordings recognised as unknown",
            pct(matrix["unknown"]["unknown"], sum(matrix["unknown"].values())),
        ),
        ('Baseline: always say "no murmur" (accuracy on present/absent)', pct(len(absent), len(present) + len(absent))),
    ]

    lines = [
        "# AI results: CardioPHON encoder + our murmur head",
        "",
        f"Generated {datetime.now(UTC).date()} by `scripts/ai/evaluate.py`. Model `{meta['model_name']} "
        f"{meta['model_version']}` (trained {meta['trained_at']}). Spec: `docs/specs/2026-11-08-ai-model.md`.",
        "",
        f"Test set: **{len(test_patients)} CirCor patients never used to train the head** ({len(test)} recordings, "
        f"seed {split['seed']}, split hash `{meta['split_sha256'][:12]}`). Recording level, one point per recording.",
        "",
        "| Measure | Result |",
        "| --- | --- |",
        *[f"| {name} | {value} |" for name, value in rows],
        "",
        "Confusion matrix (rows = truth, columns = model):",
        "",
        "| truth \\ model | " + " | ".join(classes) + " |",
        "| --- | " + " | ".join("---" for _ in classes) + " |",
        *[f"| {t} | " + " | ".join(str(matrix[t][p]) for p in classes) + " |" for t in classes],
        "",
        "## Read this before quoting the numbers",
        "",
        "- CirCor is children from Brazil recorded with a clinical digital stethoscope. Our device is a cheap I2S",
        "  microphone and demo patients are adults: expect lower accuracy on real use.",
        "- The CardioPHON encoder was pre-trained without labels on several heart-sound datasets that include",
        "  CirCor, so it has heard these test recordings (never their labels). The head never saw the test patients.",
        "- Recordings of murmur patients at points where the murmur was not marked audible are left out (ambiguous).",
        "- The first training run left out CardioPHON's feature standardisation (train accuracy 54 %); it was fixed to",
        "  match the original code before the test patients were ever evaluated. Nothing was tuned on the test set.",
        "- Recording level (one 20 s recording, one point), not patient level like the PhysioNet 2022 challenge.",
        "- AST (Hugging Face) was not compared: huggingface.co is unreachable from this network (2026-11-08).",
        "- Screening aid for a research prototype, not a diagnosis.",
        "",
    ]
    RESULTS.write_text("\n".join(lines), encoding="utf-8", newline="\n")
    print("\n".join(lines[6:22]))
    print("written", RESULTS)


if __name__ == "__main__":
    main()
