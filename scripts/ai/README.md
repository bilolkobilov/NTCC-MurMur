# MurMur AI model

The murmur analyzer: a recording goes in, the doctor sees **murmur** / **no murmur** / **too poor to judge**. It is a
screening aid for a research prototype, **not a diagnosis**.

## How it works

1. **Encoder:** CardioPHON (pre-trained, BYOL-A `AudioNTT2022` network) turns 4 kHz audio into a 3072-number embedding.
   Code: `backend/app/services/ai/cardiophon.py`.
2. **Head:** a small MLP trained here on CirCor labels. A recording is cut into 4 s windows; the window probabilities
   are averaged and the recording is flagged **murmur** when P(present) ≥ a stored threshold (chosen by
   cross-validation to catch ~80 % of murmurs).
3. **Server:** `backend/app/services/analyzer.py` picks the analyzer from `AI_MODEL`. `dummy` (default, and the
   fallback when weight files are missing) gives no opinion; `cardiophon` runs the model above. Every `AIResult`
   stores the model name and version (`models/cardiophon/murmur_head.json`).

Quality rules (too short, almost silent, clipped, motion) run before the AI in `backend/app/services/quality.py`; a
recording that fails them is marked `failed` with a re-record reason, never sent to the model.

## Current results (model `cardiophon-murmur 1.1.0`)

Measured once on 189 held-out CirCor patients (604 recordings), recording level:

| Sensitivity | Specificity | AUC |
| --- | --- | --- |
| 88.0 % | 66.7 % | 0.892 |

Read the caveats in `docs/specs/ai-results.md` before quoting these: CirCor is children recorded with a clinical
stethoscope, while MurMur uses a cheap I2S microphone and demo patients are adults, so expect lower accuracy in real
use. Experiments: `docs/specs/ai-experiments.md`. Spec: `docs/specs/2026-11-08-ai-model.md`.

## Files here

| File | Purpose |
| --- | --- |
| `circor.py` | CirCor 1.0.3 labels and the train / test split (by patient, seed 2026) |
| `learn.py` | shared training and metrics (sensitivity, specificity, no-answer rate) |
| `experiment.py` | compare head recipes by 5-fold CV on training patients; writes `docs/specs/ai-experiments.md` |
| `train_head.py` | train the final head and its threshold; writes `models/cardiophon/murmur_head.{pt,json}` |
| `evaluate.py` | measure the head once on the held-out test patients; writes `docs/specs/ai-results.md` |

## Setup

Weights and data are not in Git (`models/`, `samples/` are gitignored).

```bash
cd backend && uv sync                         # includes PyTorch CPU + numpy (group `ai`)
```

1. Download the CardioPHON encoder into `models/cardiophon/` (use with citation, never commit):
   `pretrained_physionet_2022_4kHz.pth`, from <https://git.lih.lu/vdespotovic/cardiophon> (exact `curl` line in
   `docs/runbook.md`).
2. Unpack CirCor 1.0.3 (471 MB, ODC-By) into `samples/circor/` from PhysioNet; check `SHA256SUMS.txt`.

## Train and evaluate

Run from `backend/`:

```bash
uv run python ../scripts/ai/experiment.py     # optional, ~15 min
uv run python ../scripts/ai/train_head.py     # ~3 min
uv run python ../scripts/ai/evaluate.py       # once, on held-out patients
```

Then set `AI_MODEL=cardiophon` in `.env` and restart the server; the log says `AI model loaded: cardiophon-murmur …`.
On Windows set `PYTHONIOENCODING=utf-8` if the console shows encoding errors.

## Rules

- **Never tune on the test patients.** Choices (recipe, threshold) use cross-validation inside the training patients
  only; `evaluate.py` runs once per finished model.
- **Bump `MODEL_VERSION` in `train_head.py` on every retrain.** It is stored with every result.
- The answer vocabulary (`murmur` / `absent` = an answer, quality `bad` = too poor to judge) is mirrored in the
  frontend `aiOutcome.ts`; change both together.

## Citations

- V. Despotovic, P. Pocta, A. Zgank, CardioPHON, *Biomedical Signal Processing and Control* 113 (2026) 109047.
- D. Niizumi et al., BYOL-A, IJCNN 2021 (MIT, NTT Communication Science Laboratories).
- CirCor DigiScope Phonocardiogram Dataset 1.0.3, PhysioNet (ODC-By).
