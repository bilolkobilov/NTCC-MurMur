# ECG rhythm model ("AF suspected")

20 s of one ECG lead from the ADS1292R (≈ lead II, 250 Hz, mV) → the doctor sees **AF suspected** / **no AF** /
**unclear**. A screening aid for a research prototype, **not a diagnosis**. Results and limitations:
`docs/specs/ecg-ai-results.md`.

Model code (shared with the server): `backend/app/services/ai/ecg_rhythm.py` — preprocessing (resample to 250 Hz,
first 20 s, 0.5–40 Hz band-pass, robust scaling), the 1-D ResNet, `load()` and `EcgRhythm.predict()`.
Owner rule (2026-11-17): numpy + PyTorch only; the PhysioNet file formats are read by `data.py`.

## Files here

| File | Purpose |
| --- | --- |
| `download.py` | CinC 2017 zip + labels (SHA-256 pinned), PTB-XL index, then only the chosen PTB-XL fold-10 records |
| `data.py` | readers: MATLAB v4 `.mat`, WFDB `.hea` and format-16 `.dat`; paths; ID lists |
| `split.py` | the one-time CinC split 80 / 10 / 10 (stratified, seed 2017) → `split/{train,val,test}.txt` |
| `train.py` | trains the candidates, picks epoch / architecture / AF threshold on validation → `models/ecg/` |
| `evaluate.py` | runs the finished model once on CinC test + PTB-XL → `docs/specs/ecg-ai-results.md` |
| `split/` | committed ID lists (`ptbxl_fold10.csv` = the PTB-XL external test set) |

## Reproduce

Run from `backend/` (data lands in `samples/ecg/`, weights in `models/ecg/`; both gitignored). `-I` keeps the
downloaded folders from ever being on Python's import path.

```bash
uv run python -X utf8 -I ../scripts/ai/ecg/download.py   # ~100 MB CinC + ~68 MB PTB-XL subset
uv run python -X utf8 -I ../scripts/ai/ecg/split.py      # only once; refuses to overwrite split/
uv run python -X utf8 -I ../scripts/ai/ecg/train.py      # ~50 min on an 8-core laptop CPU
uv run python -X utf8 -I ../scripts/ai/ecg/evaluate.py   # once per finished model
```

`train.py --smoke` checks the pipeline in seconds on 300 records (writes to `models/ecg/smoke/`, delete it after).

## Rules

- **Never tune on test data.** Epochs, architecture and the AF threshold are chosen on `split/val.txt` only;
  `evaluate.py` runs once per finished model and checks the split files did not change since training.
- **Bump `MODEL_VERSION` in `train.py` on every retrain.** It is stored with every result.
- Keep `preprocess()` / `clean()` the only preprocessing; training and the server must not drift apart.

## Data, licences, citations

- **PhysioNet/CinC Challenge 2017** training set 1.0.0, <https://physionet.org/content/challenge-2017/1.0.0/>,
  Open Data Commons Attribution License v1.0 (ODC-By 1.0). Cite: G. D. Clifford, C. Liu, B. Moody, L. H. Lehman,
  I. Silva, Q. Li, A. E. Johnson, R. G. Mark, *AF Classification from a Short Single Lead ECG Recording: the
  PhysioNet/Computing in Cardiology Challenge 2017*, Computing in Cardiology 44 (2017).
- **PTB-XL** 1.0.3, <https://physionet.org/content/ptb-xl/1.0.3/>, Creative Commons Attribution 4.0 (CC BY 4.0).
  Cite: P. Wagner, N. Strodthoff, R.-D. Bousseljot, D. Kreiseler, F. I. Lunze, W. Samek, T. Schaeffter, *PTB-XL, a
  large publicly available electrocardiography dataset*, Scientific Data 7, 154 (2020), and the PhysioNet
  record (Wagner et al., PhysioNet, 2022, version 1.0.3).
- Both via PhysioNet: A. L. Goldberger et al., *PhysioBank, PhysioToolkit, and PhysioNet*, Circulation 101(23),
  e215–e220 (2000).
