# AI results: CardioPHON encoder + our murmur head

Generated 2026-11-08 by `scripts/ai/evaluate.py`. Model `cardiophon-murmur 1.0.0` (trained 2026-11-08T15:34:15+00:00). Spec: `docs/specs/2026-11-08-ai-model.md`.

Test set: **189 CirCor patients never used to train the head** (604 recordings, seed 2026, split hash `3d8946a8d3da`). Recording level, one point per recording.

| Measure | Result |
| --- | --- |
| Sensitivity (murmur found when there is one) | 57.0% (57/100) |
| Specificity (no murmur said when there is none) | 70.1% (328/468) |
| Accuracy when it answers (true present/absent only) | 80.4% (385/479) |
| No answer ("too poor to judge") on real present/absent | 15.7% (89/568) |
| Unknown recordings recognised as unknown | 41.7% (15/36) |
| Baseline: always say "no murmur" (accuracy on present/absent) | 82.4% (468/568) |

Confusion matrix (rows = truth, columns = model):

| truth \ model | present | absent | unknown |
| --- | --- | --- | --- |
| present | 57 | 31 | 12 |
| absent | 63 | 328 | 77 |
| unknown | 7 | 14 | 15 |

## Read this before quoting the numbers

- CirCor is children from Brazil recorded with a clinical digital stethoscope. Our device is a cheap I2S
  microphone and demo patients are adults: expect lower accuracy on real use.
- The CardioPHON encoder was pre-trained without labels on several heart-sound datasets that include
  CirCor, so it has heard these test recordings (never their labels). The head never saw the test patients.
- Recordings of murmur patients at points where the murmur was not marked audible are left out (ambiguous).
- The first training run left out CardioPHON's feature standardisation (train accuracy 54 %); it was fixed to
  match the original code before the test patients were ever evaluated. Nothing was tuned on the test set.
- Recording level (one 20 s recording, one point), not patient level like the PhysioNet 2022 challenge.
- AST (Hugging Face) was not compared: huggingface.co is unreachable from this network (2026-11-08).
- Screening aid for a research prototype, not a diagnosis.
