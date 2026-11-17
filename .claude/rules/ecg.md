---
paths:
  - "backend/app/services/ecg.py"
  - "backend/app/services/ai/ecg_rhythm.py"
  - "backend/app/services/analysis.py"
  - "backend/app/models/ecg.py"
  - "scripts/ai/ecg/**"
  - "frontend/src/features/doctor/exam/Ecg*"
  - "frontend/src/features/doctor/exam/ecgOutcome.ts"
---

# ECG rules

- An ECG problem never changes the exam's status: `analysis._analyze_ecg` stores `quality="bad"` + a problem code and
  the sound analysis runs on.
- The ECG is doctor-only: never add it to admin or patient responses; `tests/test_ecg.py` pins this.
- Problem codes (`services/ecg.py`) and rhythm labels (`services/ai/ecg_rhythm.py`) are mirrored by the frontend
  `ecgOutcome.ts`; change both together and add the uz / ru / en texts.
- The limits in `services/ecg.py` are signal-processing limits ("can we trust the measurement"), not medical ranges;
  never add "normal / abnormal" heart-rate words without a doctor's decision.
- `services/ecg.py` stays pure Python (heart rate must work without the AI group); only the rhythm model may use
  numpy / torch, imported lazily.
- The rhythm model is trained and tuned on validation data only and tested once (`scripts/ai/ecg/`); every stored
  result carries the model name and version. Show it as "AF suspected — confirm with a 12-lead ECG", never a diagnosis.
- Never commit a volunteer's real ECG recording; tests use the synthetic `tests/helpers.make_ecg`.
