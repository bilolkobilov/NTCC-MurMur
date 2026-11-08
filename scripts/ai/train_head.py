"""Train the murmur head that the server uses, on all training patients (the 189 test patients are never touched).

Run from backend/:  uv run python ../scripts/ai/train_head.py
1. 5-fold cross-validation inside the training patients → the threshold that flags ~80 % of murmur recordings
   (owner 2026-11-08: catch more murmurs). The threshold never sees a test patient.
2. Fit the head on all training patients; save models/cardiophon/{murmur_head.pt, murmur_head.json, split.json}.
The recipe is the winner of scripts/ai/experiment.py (docs/specs/ai-experiments.md).
"""

import hashlib
from datetime import UTC, datetime

import circor
import learn
import torch

from app.services.ai import cardiophon

MODEL_VERSION = "1.1.0"  # bump on every retrain: stored with every AI result
RECIPE = learn.Config("4 s windows, present/absent, MLP", 4.0, ("present", "absent"))


def main() -> None:
    recs = circor.recordings()
    test = circor.test_patients(recs)
    train = [r for r in recs if r.patient not in test]
    print(f"recipe: {RECIPE.name} · train {len(train)} recordings of {len({r.patient for r in train})} patients")

    cv = learn.cross_validate(RECIPE, train, learn.folds(train))
    threshold = cv["at80"]["threshold"]
    print(
        f"cross-validation: AUC {cv['at80']['auc']:.3f} · threshold {threshold:.3f} -> "
        f"sensitivity {cv['at80']['sensitivity']:.1%}, specificity {cv['at80']['specificity']:.1%}"
    )

    vectors = circor.embeddings(train, RECIPE.window_s)
    head = learn.fit(RECIPE, *learn.training_rows(RECIPE, train, vectors), seed=circor.SEED, log=print)

    circor.OUT.mkdir(parents=True, exist_ok=True)
    torch.save(head.state_dict(), circor.OUT / cardiophon.HEAD_FILE)
    split = sorted(test)
    circor.save_json(circor.OUT / "split.json", {"seed": circor.SEED, "test_patients": split})
    circor.save_json(
        circor.OUT / "murmur_head.json",
        {
            "model_name": "cardiophon-murmur",
            "model_version": MODEL_VERSION,
            "classes": list(RECIPE.classes),
            "arch": RECIPE.arch,
            "window_s": RECIPE.window_s,
            "threshold": round(threshold, 6),
            "trained_at": datetime.now(UTC).isoformat(timespec="seconds"),
            "train_recordings": len(train),
            "cross_validation": {k: v for k, v in cv["at80"].items() if k != "threshold"},
            "split_sha256": hashlib.sha256(",".join(split).encode()).hexdigest(),
            "recipe": RECIPE.as_dict(),
        },
    )
    print("saved", circor.OUT / cardiophon.HEAD_FILE)


if __name__ == "__main__":
    main()
