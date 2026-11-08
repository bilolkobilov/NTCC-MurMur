# Code map

Where things live. One line per path, at most ~150 characters, whole file under 15 KB. Behaviour and history are NOT
here: decisions → `docs/decisions/`, how to run / configure / deploy → `docs/runbook.md`.

## Root

- `AGENTS.md` — all project rules (Claude reads it through `CLAUDE.md`)
- `CLAUDE.md` — only imports `AGENTS.md`
- `.gitignore` — ignores `.env`, Python caches, `storage/`, `samples/`
- `.claude/settings.json` — permissions + hook that blocks reading secret files
- `.claude/secret-files.txt` — list of real secret files (`.env`)
- `.claude/hooks/block-secrets.mjs` — the hook itself
- `docker-compose.yml` — PostgreSQL 16 (`db` service), values from `.env`
- `.env.example` — every config key, no real values

## Backend

- `backend/pyproject.toml` — dependencies (uv), pytest config, pure-Python SQLAlchemy setting
- `backend/app/main.py` — `create_app()`: CORS, routers, `/api/health`
- `backend/app/config.py` — `Settings` from env / `.env`; builds the database URL
- `backend/app/db.py` — engine, `SessionLocal`, `Base` (constraint naming), `CreatedAtMixin`, `get_db` dependency
- `backend/app/security.py` — bcrypt passwords, JWT tokens, device API key generation + SHA-256 hash
- `backend/app/deps.py` — auth dependencies: `CurrentUser/Admin/Doctor/Patient`, `CurrentDevice` (X-Device-Key)
- `backend/app/cli.py` — `python -m app.cli create-admin` (first admin from env, idempotent)
- `backend/app/api/auth.py` — login, change-password, `/api/auth/me`
- `backend/app/schemas/` — request/response shapes; `common.py` has password/username field rules
- `backend/app/services/errors.py` — `NotFound`/`Conflict`/`BadRequest`; mapped to HTTP in `main.py`
- `backend/app/services/users.py` — create user, authenticate, change password
- `backend/app/api/admin.py` — `/api/admin/*`: doctors, devices (+ one-time key), stats, audit
- `backend/app/services/doctors.py` — create / list (with patient count) / block doctors
- `backend/app/services/devices.py` — register device + key, assign to doctor, `is_online` (30 s window)
- `backend/app/services/stats.py` — admin counts; "today" uses `APP_TIMEZONE`
- `backend/app/services/audit.py` — `record()` a read of patient data, list entries
- `backend/app/api/doctor.py` — `/api/patients/*`, `/api/exams/*` for the doctor
- `backend/app/services/patients.py` — doctor's own patients, consent, patient login (temp password); audits reads
- `backend/app/services/exams.py` — doctor's own exams: start, read, audio path, review; audits reads
- `backend/app/services/exam_flow.py` — the ONLY place exam status changes; allowed transitions table
- `backend/app/services/storage.py` — WAV files on disk as `<uuid>.wav` in `RECORDINGS_DIR`
- `backend/app/models/` — one file per table (8 tables); `enums.py` holds roles, statuses, points; `__init__` imports all
- `backend/alembic.ini`, `backend/alembic/env.py` — Alembic; DB URL comes from app settings, not the ini
- `backend/alembic/versions/` — migrations, numbered `0001_…`
- `backend/tests/conftest.py` — forces `murmur_test`, rebuilds it via migrations per run, empties tables per test
- `backend/tests/test_migrations.py` — tables exist, models match migrations, downgrade/upgrade round trip
- `backend/tests/helpers.py` — `make_user`, `login`, `make_device`, `make_patient` builders shared by tests

## Docs

- `docs/PLAN.md` — full MVP plan in Uzbek (hardware, AI, roles, weekly plan)
- `docs/map.md` — this file
- `docs/runbook.md` — how to run and test
- `docs/decisions/` — owner's decisions by month

## Not built yet (Stage 1 adds these; move a line up when it exists)

- patient and device routers, analyzer
- scripts/fake_device.py — simulated device
