# AGENTS.md — MurMur

Standing rules for every task in this repository.

## What this is

NTCC university project (B.Tech CSE): a portable heart-sound screening device (ESP32-S3 + I2S microphone) that
records ~20 s of heart sound and sends it to our backend, where a local AI model analyzes it. Doctors see the results
on a website. Research prototype and screening aid, NOT a medical device.

## Where to start

- `docs/map.md` — where everything lives (small file, read it in full).
- `docs/runbook.md` — setup, config, tests, deploy.
- `docs/decisions/` — the owner's decisions, by month, newest on top.
- `docs/PLAN.md` — the full MVP plan (in Uzbek). If it conflicts with this file, AGENTS.md wins.

## Repository layout

- `backend/` — FastAPI app (`app/`: `api/` routers, `schemas/`, `models/`, `services/`), Alembic, pytest tests.
- `frontend/` — React + Vite web app (admin / doctor / patient, uz / ru / en); FastAPI serves its build in demo mode.
- `backend/app/services/ai/` + `scripts/ai/` — the CardioPHON murmur model and its training / evaluation scripts;
  `models/` and `samples/circor/` hold downloaded weights and data (gitignored).
- `scripts/fake_device.py` — simulated device while there is no hardware; `samples/` — sample WAVs (gitignored).
- `firmware/murmur/` — ESP32-S3 Arduino firmware (mic + Wi-Fi + device API); secrets in gitignored `secrets.h`.
- `docker-compose.yml` — PostgreSQL only.
- Layered, not flattened: routers stay thin, business rules live in `services/`. "Small" means fewer features,
  not fewer layers.
- Build something new only when it is needed now ("we are not enterprise") — the smallest variant.

## Stack (fixed — ask before changing anything here)

- Python 3.14 (owner's installed Python, run via `py`), FastAPI, SQLAlchemy 2.0 (sync, psycopg 3), Alembic,
  Pydantic v2 + pydantic-settings.
- Auth: PyJWT access tokens, bcrypt password hashing.
- Database: PostgreSQL 16 via Docker Compose, from day one. No SQLite anywhere, including tests.
- Tests: pytest + FastAPI TestClient against a separate Postgres test database (`murmur_test`).
- Package manager: uv.
- Frontend: React 19 + Vite, TypeScript ~5.9, Tailwind 4, TanStack Query, react-i18next, Vitest, ESLint
  (`frontend/`, owner-approved spec `docs/specs/2026-11-08-web-frontend.md`).
- AI: PyTorch CPU + numpy in the backend's `ai` dependency group (owner, 2026-11-08).
- Firmware: Arduino-ESP32 3.x (built-in ESP_I2S, WiFi, HTTPClient), compiled with arduino-cli; MPU6050 and ECG later.
- No microservices, no Celery/Redis, no Kubernetes. Ask before adding dependencies outside this stack.

## Roles and access rules (must be enforced AND covered by tests)

- **No public signup.** The first admin is created with a CLI command using values from env.
- Everyone logs in with a `username` (not email). Any logged-in user can change their own password.
- **admin**: creates and blocks doctors; manages devices (on create, generate an API key, show it once, store only
  its hash; assign a device to a doctor); sees system stats and the audit log. Admin does NOT see patients' medical
  data (recordings, AI results, doctor notes), only counts.
- **doctor**: created by admin, who sets the password (no forced change). Creates patients and a login for each
  patient (temporary password shown once; the patient must change it on first login). Sees ONLY their own patients.
  Creates exams on devices assigned to them, adds a note + agree/disagree with the AI, and marks an exam `reviewed`.
- **patient**: created by a doctor. Sees ONLY their own profile and their own exams with status `reviewed` (including
  the doctor's note). Sees the AI's yes / no label only on reviewed exams (never the score, model or agreement); never sees unreviewed exams or other patients. Edits only own contact details.
- **device**: authenticates with header `X-Device-Key`. Can only send heartbeats, poll its own commands, and upload
  audio for exams assigned to it.

## Data model

Tables: `users` (role: admin/doctor/patient), `devices`, `patients` (linked to a doctor and to a patient user),
`exams`, `recordings`, `ai_results`, `device_commands`, `audit_logs`. Field details: PLAN.md section 4.

- Exam status flow: `waiting → recording → uploaded → analyzed → reviewed` (or `failed`).
- Auscultation point per exam: one of `AV`, `PV`, `TV`, `MV`.
- An exam cannot be created if the patient has no recorded consent (`consent_given_at` is null).
- Every AI result stores the model name and model version.

## Device flow

- `POST /api/device/heartbeat` — every ~10 s: firmware version, Wi-Fi RSSI. Updates `last_seen_at`; a device is
  "online" if seen in the last 30 s.
- `GET /api/device/command` — the device polls every 1–2 s; returns the pending command (e.g. record 20 s for
  exam X) or nothing.
- `POST /api/device/upload/{exam_id}` — multipart: `audio` (WAV) + `meta` (JSON: sample rate, motion flag, etc.).
  The upload request must carry `Content-Length` (else 411); bodies over `MAX_UPLOAD_MB` + 64 KB get 413 before they
  are read (`app/upload_limit.py`). A retried upload of an already uploaded exam gets 409 — firmware treats 409 as
  "already done".
- Save WAV as `storage/recordings/<uuid>.wav`. File names never contain patient names.
- After upload, run analysis as a FastAPI BackgroundTask: first the plain quality rules (`services/quality.py`:
  too short / almost silent / clipped / motion → exam `failed` with a "re-record" reason), then the `Analyzer`.
  `AI_MODEL=cardiophon` runs the CardioPHON murmur model (`services/ai/cardiophon.py`, version in
  `models/cardiophon/murmur_head.json`); `dummy` (default, and the fallback when files are missing) says nothing.
  Answer vocabulary: label `murmur` / `absent` = an answer, quality `bad` = too poor to judge (`analyzer.py`).

## Security

- bcrypt for passwords; device API keys stored hashed; short-lived JWT access tokens.
- Role checks via FastAPI dependencies, never ad-hoc inside handlers.
- Write an `audit_logs` row whenever a doctor or patient reads or changes patient data. Changes are logged every
  time; the same read by the same user of the same record is logged once per 5 minutes (`audit.record_read`) —
  pages poll (owner, 2026-11-08).
- Uploads: accept WAV only, enforce a size limit.
- Secrets only in `.env` (gitignored); commit `.env.example`. CORS origins from env.

## Secrets

- The list of real secret files is `.claude/secret-files.txt` (a hook blocks reading them).
- The template file is `.env.example` — add any new key there first.
- Never read, print, log, commit or report a secret value. Name the key only, or write `<set>` / `<missing>`.

## Do not guess

- Do not invent endpoints, provider formats, secrets or reference values.
- Do not invent business rules about money, permissions or user data — ask.
- If a trustworthy source is missing, finish the safe part, state the blocker clearly, and ask for the needed value.

## Working rules

- Write tests together with each feature, and keep `pytest` green before calling a task done.
- UI follows the approved design system `.interface-design/system.md`; every text in uz / ru / en
  (`docs/glossary.md` for medical terms).
- AI results are measured only on held-out patients (`scripts/ai/`); never tune on the test patients.
- Small, focused commits with clear messages.
- Keep `README.md` up to date with how to run the project and the tests.

## File hygiene

- At the end of each task, delete temporary scripts, one-off probes/diagnostics, outdated docs and unused drafts.
- Do not keep files "just in case"; anything needed later can be recovered from Git history.
- Keep the user's unrelated files and changes untouched.
- A commit that changes the structure also updates `docs/map.md`; a new owner decision goes into `docs/decisions/`.

## Definition of done

- Evidence before saying "done": the result of `cd backend && uv run python -m pytest` (all green, not 0 tests) and a
  clean `uv run python -m ruff check . ../scripts` + `uv run python -m ruff format --check . ../scripts`.
- If the frontend changed: a clean `cd frontend && npx tsc -b && npm run lint && npm test && npm run build &&
  npm run check:offline`.
- Deploy only as one package agreed with the owner, once, at the end.
