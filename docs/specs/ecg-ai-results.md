# ECG rhythm model: results

Generated 2026-11-17 by `scripts/ai/ecg/evaluate.py`, run once on the finished model `ecg-rhythm 1.0.0` (trained 2026-11-17T10:17:33+00:00). Research prototype and screening aid, **not a medical device**. Reproduce: `scripts/ai/ecg/README.md`.

## Data

- **Training / validation / test:** PhysioNet/CinC Challenge 2017 training set (8528 single-lead AliveCor recordings, 300 Hz, 9–61 s; ODC-By 1.0), final labels `REFERENCE-v3.csv`: normal, AF, other rhythm, noisy.
- **Split:** made once, 80 / 10 / 10 stratified by class, seed 2017 (6820 / 854 / 854 records; lists in `scripts/ai/ecg/split/`). **CinC 2017 publishes no patient IDs, so this is a record-level split**: one person may have records in both training and test, which can make the CinC test numbers optimistic.
- **External check (patient-level):** PTB-XL 1.0.3 (CC BY 4.0), strat_fold 10 only (PTB-XL keeps each patient in one fold), lead II at 500 Hz, 10 s each: all 152 AF recordings and 348 clean sinus (NORM + SR) recordings sampled with seed 2017 (`split/ptbxl_fold10.csv`). Never used for training or any choice.

## Model and training

- **Input contract:** 1-D signal in mV, resampled to 250 Hz, first 20 s (shorter is zero-padded), band-pass 0.5–40 Hz by FFT mask (also removes 50 / 60 Hz), centred on the median and divided by the 99th percentile of |x|. CinC records are resampled 300 → 250 Hz; PTB-XL 500 → 250 Hz and padded from 10 s to 20 s.
- **Network:** 1-D ResNet `resnet-5x1` (427,460 parameters, weights 1.75 MB), 4 outputs, class-weighted cross-entropy, AdamW + one-cycle learning rate, 40 epochs, batch 64, random 20 s crops (15 % shorter crops), augmentation: polarity flip, amplitude ×0.5–2, baseline wander, 50 / 60 Hz hum, noise.
- **Chosen on validation only** (best epoch by validation CinC F1, then the architecture):

| Candidate | Parameters | Best epoch | Val CinC F1 (N/A/O) | Val macro F1 (4 classes) | Train time |
| --- | --- | --- | --- | --- | --- |
| `resnet-4x2` | 821,924 | 32 | 0.788 | 0.712 | 28 min |
| `resnet-5x1` (chosen) | 427,460 | 35 | 0.801 | 0.722 | 20 min |

Total training time 48 min on the laptop CPU (8 threads).
- **AF threshold 0.0864:** the highest P(AF) at which validation AF sensitivity stays ≥ 90.0 % (capped at 0.5). On validation: AF sensitivity 90.8 %, specificity 90.5 %. Validation has only 76 AF records, so this choice is itself uncertain by several percentage points.

## CinC 2017 test set (held-out records, run once)

Four-class result (most likely class), first 20 s of each record:

| True \ Predicted | Normal | AF | Other | Noisy |
| --- | --- | --- | --- | --- |
| Normal | 451 | 5 | 25 | 27 |
| AF | 1 | 68 | 7 | 0 |
| Other | 55 | 15 | 156 | 16 |
| Noisy | 1 | 1 | 0 | 26 |

| Class | n | Sensitivity | Specificity | PPV | F1 |
| --- | --- | --- | --- | --- | --- |
| Normal | 508 | 88.8 % | 83.5 % | 88.8 % | 0.888 |
| AF | 76 | 89.5 % | 97.3 % | 76.4 % | 0.824 |
| Other | 242 | 64.5 % | 94.8 % | 83.0 % | 0.726 |
| Noisy | 28 | 92.9 % | 94.8 % | 37.7 % | 0.536 |

- **Macro F1 (4 classes): 0.743**; **CinC F1 (mean of normal / AF / other, the challenge score): 0.813**.

Product answer (what a doctor would see):

| True class | AF suspected | No AF | Unclear |
| --- | --- | --- | --- |
| Normal | 14 | 467 | 27 |
| AF | 75 | 1 | 0 |
| Other | 48 | 178 | 16 |
| Noisy | 1 | 1 | 26 |

- **AF sensitivity 98.7 %** (95 % CI 95.8 % – 100.0 %), **specificity 91.2 %** (95 % CI 89.1 % – 93.4 %) over normal + other recordings that got an answer.
- Specificity on normal recordings alone: 97.1 %; on 'other rhythm' alone: 78.8 %. Most false AF alarms come from other arrhythmias (irregular beats), not from normal hearts.
- Test AF sensitivity is higher than on validation (90.8 %) with the same threshold. With 76 AF records per set this gap is within chance, and the record-level split may also help the test set; expect about the validation level, or lower, on new people.

## PTB-XL external check (AF vs sinus, lead II, other patients)

- **AF sensitivity 86.2 %** (95 % CI 80.4 % – 91.4 %), **specificity 99.1 %** (95 % CI 98.0 % – 100.0 %).
- Unclear: 9.2 % of AF, 0.6 % of sinus recordings. Sinus recordings' most likely class: normal 320, AF 0, other 26, noisy 2.
- AF sensitivity among AF recordings that got an answer: 94.9 %. Missed AF: 14 'unclear' (the model called the recording 'noisy'), 7 'no AF'.

## Limitations

- **Lead shift.** CinC 2017 is a hand-held AliveCor device (roughly lead I, fingers); PTB-XL is a clinical 12-lead ECG (we use lead II); our ADS1292R chest lead is lead-II-like but not identical. Waveform shape, amplitude and noise differ between all three.
- **No patient IDs in CinC 2017**: the CinC test is record-level; PTB-XL fold 10 is the only patient-level check, and only for AF vs clean sinus (no 'other rhythm' or noisy cases there).
- **PTB-XL records are 10 s**, padded to 20 s; our exams are 20 s. Fewer beats make AF harder to see.
- **Our device is not validated.** One 32 s ADS1292R recording of a healthy volunteer (CH1, first 2 s dropped, ~68 bpm) gave 'no AF' (P(AF) 0.001) on its first 20 s, its last 20 s and with inverted polarity. There is no AF recording from our hardware. Numbers here say nothing yet about accuracy on MurMur recordings.
- **Small AF counts** (76 validation, 76 test, 152 PTB-XL): read the confidence intervals, not just the point estimates.
- 'Other rhythm' is a broad mix (ectopy, flutter, blocks…); the product does not show it.

## Citations

- G. D. Clifford et al., AF Classification from a Short Single Lead ECG Recording: the PhysioNet/Computing in Cardiology Challenge 2017. Computing in Cardiology 44 (2017).
- P. Wagner et al., PTB-XL, a large publicly available electrocardiography dataset. Scientific Data 7, 154 (2020); PTB-XL 1.0.3 on PhysioNet.
- A. L. Goldberger et al., PhysioBank, PhysioToolkit, and PhysioNet. Circulation 101(23) (2000).
