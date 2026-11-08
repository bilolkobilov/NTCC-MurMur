"""Compare head recipes by 5-fold cross-validation INSIDE the training patients (spec §10).
The held-out test patients are never loaded here. Writes docs/specs/ai-experiments.md.

Run from backend/:  uv run python ../scripts/ai/experiment.py [config names…]
"""

import sys
from datetime import UTC, datetime

import circor
import learn

CONFIGS = [
    learn.Config("1.0.0 recipe: whole, 3 answers, MLP", None),
    learn.Config("whole, present/absent, MLP", None, ("present", "absent")),
    learn.Config("4 s windows, 3 answers, MLP", 4.0),
    learn.Config("4 s windows, present/absent, MLP", 4.0, ("present", "absent")),
    learn.Config(
        "4 s windows, present/absent, linear", 4.0, ("present", "absent"), "linear", 10, 1e-3, 1e-3, 64, False
    ),
    learn.Config("4 s windows, present/absent, MLP wd", 4.0, ("present", "absent"), "mlp", 12, 3e-4, 1e-3, 64, False),
    learn.Config("8 s windows, present/absent, MLP", 8.0, ("present", "absent")),
    learn.Config("2 s windows, present/absent, MLP", 2.0, ("present", "absent")),
]
OUT = circor.REPO / "docs" / "specs" / "ai-experiments.md"


def main() -> None:
    recs = circor.recordings()
    test = circor.test_patients(recs)
    train_recs = [r for r in recs if r.patient not in test]
    fold_of = learn.folds(train_recs)
    chosen = [c for c in CONFIGS if not sys.argv[1:] or c.name in sys.argv[1:]]
    rows = []
    for cfg in chosen:
        result = learn.cross_validate(cfg, train_recs, fold_of)
        d, a = result["default"], result["at80"]
        rows.append(
            f"| {cfg.name} | {d['auc']:.3f} | {d['sensitivity']:.1%} / {d['specificity']:.1%} | "
            f"{a['sensitivity']:.1%} / **{a['specificity']:.1%}** | {a['no_answer']:.1%} |"
        )
        print(rows[-1], flush=True)
    lines = [
        "# AI experiments (cross-validation inside the training patients)",
        "",
        f"Generated {datetime.now(UTC).date()} by `scripts/ai/experiment.py`: {len(train_recs)} recordings of "
        f"{len(fold_of)} training patients, {learn.FOLDS} patient-level folds; the 189 test patients are not used.",
        "Choose by **specificity at ~80 % sensitivity** (owner's screening trade-off); AUC is threshold-free.",
        "",
        "| Recipe | AUC | default sens / spec | at ~80 % sens: sens / spec | no answer |",
        "| --- | --- | --- | --- | --- |",
        *rows,
        "",
    ]
    OUT.write_text("\n".join(lines), encoding="utf-8", newline="\n")
    print("written", OUT)


if __name__ == "__main__":
    main()
