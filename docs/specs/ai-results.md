# AI results: CardioPHON encoder + our murmur head

Generated 2026-11-08 by `scripts/ai/evaluate.py`. Model `cardiophon-murmur 1.1.0` (trained 2026-11-08T16:19:53+00:00): 4 s windows, present/absent, MLP, threshold 0.186 chosen by cross-validation for ~80 % sensitivity (owner: catch more murmurs).
Specs: `docs/specs/2026-11-08-ai-model.md` §10, experiments: `docs/specs/ai-experiments.md`.

Test set: **189 CirCor patients never used for training or for any choice** (604 recordings, seed 2026, split hash `3d8946a8d3da`). Recording level.

| | Sensitivity (murmurs found) | Specificity (normals not flagged) | No answer | AUC |
| --- | --- | --- | --- | --- |
| **1.1.0 on test (production threshold)** | **88.0%** | **66.7%** | 0.0% | 0.892 |
| 1.1.0 on test, most-likely answer (no threshold) | 65.0% | 96.6% | 0.0% | |
| 1.1.0 cross-validation (training patients) | 80.2% | 73.4% | 0.0% | 0.854 |
| 1.0.0 on test (whole recording, 3 answers) | 57.0% | 86.5% | 15.7% | |

On test: 100 murmur and 468 normal recordings.

| truth \ model | murmur | no murmur |
| --- | --- | --- |
| present | 88 | 12 |
| absent | 156 | 312 |
| unknown | 18 | 18 |

## Read this before quoting the numbers

- CirCor is children from Brazil recorded with a clinical digital stethoscope. Our device is a cheap I2S
  microphone and demo patients are adults: expect lower accuracy on real use.
- The CardioPHON encoder was pre-trained without labels on several heart-sound datasets that include
  CirCor, so it has heard these test recordings (never their labels). The head never saw the test patients.
- Recordings of murmur patients at points where the murmur was not marked audible are left out (ambiguous).
  CirCor's "unknown" recordings are not used for training 1.1.0; the model gives them murmur / no murmur.
- 1.0.0 was evaluated on these test patients once; 1.1.0 was chosen only by cross-validation on training
  patients and then evaluated here once. The first 1.0.0 run missed CardioPHON's feature standardisation;
  that was fixed before any test evaluation.
- Recording level (one 20 s recording, one point), not patient level like the PhysioNet 2022 challenge.
- AST (Hugging Face) was not compared: huggingface.co is unreachable from this network (2026-11-08).
- Screening aid for a research prototype, not a diagnosis.
