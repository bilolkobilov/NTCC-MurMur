# MurMur backend

FastAPI service for the MurMur heart-sound screening prototype. It handles login and roles (admin / doctor / patient),
the device API (ESP32-S3 or `scripts/fake_device.py`), WAV storage, the quality rules and AI analysis, the audit log,
and (in demo mode) serves the built web app. Research prototype, **not a medical device**.

## Stack

Python 3.14, FastAPI, SQLAlchemy 2.0 (sync, psycopg 3), Alembic, Pydantic v2, PyJWT, bcrypt, PostgreSQL 16, uv.
PyTorch (CPU) + numpy are in the `ai` dependency group, installed by default.

## Run

```bash
docker compose up -d db                       # from the repo root; PostgreSQL 16 (needed for tests too)
cp .env.example .env                          # then fill in the values (never commit .env)
cd backend && uv sync
uv run python -m alembic upgrade head
uv run python -m app.cli create-admin         # first admin from FIRST_ADMIN_* keys in .env
uv run python -m uvicorn app.main:app --reload   # API on :8000, interactive docs at /docs
```

Always run tools as `uv run python -m <tool>` (not bare `pytest` / `ruff`). Without AI: `uv sync --no-group ai`
and `AI_MODEL=dummy`. Full setup (AI weights, firmware): `docs/runbook.md`.

## Tests and lint

```bash
uv run python -m pytest                       # whole suite; creates and migrates the `murmur_test` database
uv run python -m pytest tests/test_access_rules.py -k patient
uv run python -m ruff check . ../scripts && uv run python -m ruff format --check . ../scripts
```

Tests run against PostgreSQL only (no SQLite). `tests/conftest.py` forces `murmur_test` and empties the tables between
tests. `test_access_rules.py` and `test_full_flow.py` pin who may see what: extend them with every new endpoint.

## Layout

```
app/
  main.py          create_app(): CORS, routers, /api/health, serves frontend/dist at /
  config.py        Settings from env / .env
  deps.py          role dependencies: CurrentAdmin / Doctor / Patient, CurrentDevice (X-Device-Key)
  api/             thin routers: auth, admin, doctor, patient, device
  schemas/         request / response shapes
  models/          one file per table (users, devices, patients, exams, recordings, ai_results, device_commands, audit_logs)
  services/        business rules and audit writes (exam_flow, analysis, quality, analyzer, ai/cardiophon, ...)
alembic/           migrations (0001_...)
tests/
```

`docs/map.md` lists every file.

## Rules worth knowing

- **Routers stay thin.** They only declare a role dependency; rules live in `services/`, which raise
  `NotFound` / `Conflict` / `BadRequest` (mapped to HTTP in `main.py`).
- **Exam status changes in one place:** `services/exam_flow.py`. Flow: `waiting → recording → uploaded → analyzed →
  reviewed` (or `failed`).
- **Access is data-shaped.** Admin sees counts only, never medical data. A doctor sees only their own patients. A
  patient sees only their own `reviewed` exams, with no AI fields. Reads of patient data go through
  `audit.record_read` (same user + record logged once per 5 min).
- **Auth.** No public signup. A password change bumps `token_version` (old JWTs stop working). Login is rate-limited
  in memory. Device keys are shown once and stored as SHA-256 hashes.

## API overview

| Prefix | Who | What |
| --- | --- | --- |
| `/api/auth/*` | everyone | login, change password, `me` |
| `/api/admin/*` | admin | doctors, devices (+ one-time key, health, disconnect, self-test), stats, audit log |
| `/api/patients/*`, `/api/exams/*`, `/api/devices` | doctor | own patients, exams, own devices |
| `/api/me`, `/api/me/exams` | patient | own profile, reviewed exams |
| `/api/device/*` | device (`X-Device-Key`) | heartbeat, command poll (204 = nothing), self-test result, WAV upload (403 once the admin disconnected the device) |

### Device round trip

1. Doctor `POST /api/exams` creates a `device_commands` row.
2. The device polls `GET /api/device/command` every 1-2 s (row-locked, so a command is handed out once).
3. The device records ~20 s and `POST /api/device/upload/{exam_id}` (multipart `audio` WAV + `meta` JSON). The request
   needs `Content-Length` (else 411); bodies over `MAX_UPLOAD_MB` + 64 KB get 413. A retried upload gets 409.
4. A BackgroundTask runs `services/analysis.py`: quality rules first (too short / silent / clipped / motion → `failed`
   with a re-record reason), then the `Analyzer` from `get_analyzer()`. The `AIResult` stores model name + version.

## Configuration

Keys live in `.env` (template: `.env.example`): database, `JWT_SECRET`, login limits, `FIRST_ADMIN_*`, `CORS_ORIGINS`,
`RECORDINGS_DIR`, `MAX_UPLOAD_MB`, `MIN_RECORDING_SECONDS`, `AI_MODEL`, `AI_MODEL_DIR`, `APP_TIMEZONE`.

## Migrations

After changing a model:

```bash
uv run python -m alembic revision --autogenerate -m "what changed" --rev-id 000N   # review the file
uv run python -m alembic upgrade head
```

`tests/test_migrations.py` fails if models and migrations drift.

## Related

- AI model: `../scripts/ai/README.md`
- Web app: `../frontend/README.md`
- Simulated device: `../scripts/fake_device.py`
