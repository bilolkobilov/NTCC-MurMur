"""Measure the server's murmur head ONCE on the held-out CirCor test patients; write docs/specs/ai-results.md.

Run from backend/ after train_head.py:  uv run python ../scripts/ai/evaluate.py
Same decision as the server (CardiophonAnalyzer): windows averaged, "murmur" when P(present) ≥ the stored threshold.
Definitions: learn.py (sensitivity = murmur recordings flagged; specificity = normal recordings NOT flagged).
"""

import json
from datetime import UTC, datetime

import circor
import learn
import numpy as np
import torch

from app.services.ai import cardiophon

RESULTS = circor.REPO / "docs" / "specs" / "ai-results.md"
# 1.0.0 was measured once (2026-11-08) on this exact split and its head no longer exists, so its numbers are recorded
# here, recounted with learn.py's definitions from its confusion matrix: present 57/31/12, absent 63/328/77
# (present/absent/unknown). Shown only while the split is the same one (same hash), never next to another test set.
V100 = {
    "split_sha256": "3d8946a8d3da4aca20cf509d52b48c7085759e3c959b613611a2a9a276cad23f",
    "sensitivity": 57 / 100,
    "specificity": (328 + 77) / 468,
    "no_answer": (12 + 77) / 568,
}


def main() -> None:
    meta = json.loads((circor.OUT / "murmur_head.json").read_text(encoding="utf-8"))
    split = json.loads((circor.OUT / "split.json").read_text(encoding="utf-8"))
    recs = circor.recordings()
    test_patients = set(split["test_patients"])
    assert test_patients == circor.test_patients(recs), "split changed since training"
    test = [r for r in recs if r.patient in test_patients]

    classes = tuple(meta["classes"])
    head = cardiophon.murmur_head(meta["arch"], len(classes))
    head.load_state_dict(torch.load(circor.OUT / cardiophon.HEAD_FILE, weights_only=True))
    head.eval()
    vectors = circor.embeddings(test, meta["window_s"])
    probs = learn.recording_probs(head, test, vectors)
    truth = [r.label for r in test]
    at = learn.screening(classes, probs, truth, meta["threshold"])
    argmax = learn.screening(classes, probs, truth, None)

    flagged = probs[:, classes.index("present")] >= meta["threshold"]
    matrix = {
        t: (int(flagged[np.array(truth) == t].sum()), int((~flagged[np.array(truth) == t]).sum()))
        for t in ("present", "absent", "unknown")
    }
    cv = meta["cross_validation"]
    lines = [
        "# AI results: CardioPHON encoder + our murmur head",
        "",
        f"Generated {datetime.now(UTC).date()} by `scripts/ai/evaluate.py`. Model `{meta['model_name']} "
        f"{meta['model_version']}` (trained {meta['trained_at']}): {meta['recipe']['name']}, threshold "
        f"{meta['threshold']:.3f} chosen by cross-validation for ~80 % sensitivity (owner: catch more murmurs).",
        "Specs: `docs/specs/2026-11-08-ai-model.md` §10, experiments: `docs/specs/ai-experiments.md`.",
        "",
        f"Test set: **{len(test_patients)} CirCor patients never used for training or for any choice** ({len(test)} "
        f"recordings, seed {split['seed']}, split hash `{meta['split_sha256'][:12]}`). Recording level.",
        "",
        "| | Sensitivity (murmurs found) | Specificity (normals not flagged) | No answer | AUC |",
        "| --- | --- | --- | --- | --- |",
        f"| **{meta['model_version']} on test (production threshold)** | **{at['sensitivity']:.1%}** | "
        f"**{at['specificity']:.1%}** | {at['no_answer']:.1%} | {at['auc']:.3f} |",
        f"| {meta['model_version']} on test, most-likely answer (no threshold) | {argmax['sensitivity']:.1%} | "
        f"{argmax['specificity']:.1%} | {argmax['no_answer']:.1%} | |",
        f"| {meta['model_version']} cross-validation (training patients) | {cv['sensitivity']:.1%} | "
        f"{cv['specificity']:.1%} | {cv['no_answer']:.1%} | {cv['auc']:.3f} |",
        *(
            [
                f"| 1.0.0 on test (whole recording, 3 answers) | {V100['sensitivity']:.1%} | "
                f"{V100['specificity']:.1%} | {V100['no_answer']:.1%} | |"
            ]
            if meta["split_sha256"] == V100["split_sha256"]
            else []
        ),
        "",
        f"On test: {at['n_present']} murmur and {at['n_absent']} normal recordings.",
        "",
        "| truth \\ model | murmur | no murmur |",
        "| --- | --- | --- |",
        *[f"| {t} | {m[0]} | {m[1]} |" for t, m in matrix.items()],
        "",
        "## Read this before quoting the numbers",
        "",
        "- CirCor is children from Brazil recorded with a clinical digital stethoscope. Our device is a cheap I2S",
        "  microphone and demo patients are adults: expect lower accuracy on real use.",
        "- The CardioPHON encoder was pre-trained without labels on several heart-sound datasets that include",
        "  CirCor, so it has heard these test recordings (never their labels). The head never saw the test patients.",
        "- Recordings of murmur patients at points where the murmur was not marked audible are left out (ambiguous).",
        '  CirCor\'s "unknown" recordings are not used for training 1.1.0; the model gives them murmur / no murmur.',
        "- 1.0.0 was evaluated on these test patients once; 1.1.0 was chosen only by cross-validation on training",
        "  patients and then evaluated here once. The first 1.0.0 run missed CardioPHON's feature standardisation;",
        "  that was fixed before any test evaluation.",
        "- Recording level (one 20 s recording, one point), not patient level like the PhysioNet 2022 challenge.",
        "- AST (Hugging Face) was not compared: huggingface.co is unreachable from this network (2026-11-08).",
        "- Screening aid for a research prototype, not a diagnosis.",
        "",
    ]
    RESULTS.write_text("\n".join(lines), encoding="utf-8", newline="\n")
    print("\n".join(lines[8:15]))
    print("written", RESULTS)


if __name__ == "__main__":
    main()
