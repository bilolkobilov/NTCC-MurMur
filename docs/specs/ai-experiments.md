# AI experiments (cross-validation inside the training patients)

Generated 2026-11-08 by `scripts/ai/experiment.py`: 2442 recordings of 753 training patients, 5 patient-level folds; the 189 test patients are not used.
Choose by **specificity at ~80 % sensitivity** (owner's screening trade-off); AUC is threshold-free.


Round 1 (all recipes):

| Recipe | AUC | default sens / spec | at ~80 % sens: sens / spec | no answer |
| --- | --- | --- | --- | --- |
| 1.0.0 recipe: whole, 3 answers, MLP | 0.774 | 57.6% / 87.1% | 80.2% / **53.9%** | 9.6% |
| whole, present/absent, MLP | 0.796 | 59.1% / 88.6% | 80.2% / **57.3%** | 0.0% |
| 4 s windows, 3 answers, MLP | 0.846 | 59.6% / 93.7% | 80.2% / **70.8%** | 3.4% |
| 4 s windows, present/absent, MLP | 0.854 | 57.1% / 96.2% | 80.2% / **73.3%** | 0.0% |
| 4 s windows, present/absent, linear | 0.846 | 64.9% / 89.7% | 80.2% / **71.0%** | 0.0% |
| 4 s windows, present/absent, MLP wd | 0.854 | 58.1% / 96.3% | 80.2% / **71.5%** | 0.0% |
| 8 s windows, present/absent, MLP | 0.843 | 56.4% / 95.3% | 80.2% / **69.4%** | 0.0% |

Round 2, after one window rule change (a tail shorter than half a step no longer gets its own window), the
best recipe recomputed, plus 2 s windows:

| Recipe | AUC | default sens / spec | at ~80 % sens: sens / spec | no answer |
| --- | --- | --- | --- | --- |
| 4 s windows, present/absent, MLP | 0.854 | 56.6% / 96.0% | 80.2% / **73.4%** | 0.0% |
| 2 s windows, present/absent, MLP | 0.853 | 55.4% / 97.7% | 80.2% / **71.6%** | 0.0% |

**Chosen for 1.1.0: 4 s windows, present/absent, MLP** (highest specificity at ~80 % sensitivity, 73 % vs 54 % for
the 1.0.0 recipe; AUC 0.854 vs 0.774). Linear and weight-decay variants were no better; 2 s and 8 s windows were
worse. Fine-tuning the encoder (spec §10 step 6) was not needed for this round.
