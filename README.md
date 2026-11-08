# MurMur

Portable heart-sound screening: an ESP32-S3 device records ~20 s of heart sound, the backend stores it and runs a
local AI analyzer, and doctors review the result. Research prototype and screening aid — **not a medical device**.

Current stage: **Stage 1 — backend only** (FastAPI + PostgreSQL). No frontend, no firmware, no real AI model yet
(a `DummyAnalyzer` stands in). Full plan in Uzbek: [docs/PLAN.md](docs/PLAN.md).

## Requirements

- Docker Desktop (runs PostgreSQL 16)
- Python 3.14 and [uv](https://docs.astral.sh/uv/)

> **Windows note:** if Smart App Control is on, it blocks `.exe` launchers inside `.venv`. Always run tools as
> `uv run python -m <tool>` (e.g. `python -m pytest`, not `pytest`). See [docs/runbook.md](docs/runbook.md).

## First run

```bash
cp .env.example .env            # then replace every "change-me" with a random value
docker compose up -d db         # PostgreSQL in Docker
cd backend
uv sync                         # install dependencies
uv run python -m alembic upgrade head      # create the tables
uv run python -m app.cli create-admin      # first admin from FIRST_ADMIN_USERNAME / FIRST_ADMIN_PASSWORD
uv run python -m uvicorn app.main:app --reload
```

API: <http://localhost:8000> · interactive docs: <http://localhost:8000/docs>

## Tests

```bash
cd backend
uv run python -m pytest
```

Tests use a separate database, `murmur_test`, on the same PostgreSQL server. It is created automatically, rebuilt
from the Alembic migrations on every run, and emptied after each test. The main `murmur` database is never touched.

## Roles

| Role | Logs in with | Can |
| --- | --- | --- |
| admin | username + password (created by the CLI) | create/block doctors, register devices (API key shown once), assign devices, see stats and the audit log — never patient medical data |
| doctor | username + password set by the admin | own patients only: create, record consent, create patient login, start exams, listen, review |
| patient | username + temporary password from the doctor (must change on first login) | own profile and own **reviewed** exams with the doctor's note — never raw AI results |
| device | `X-Device-Key` header | heartbeat, poll its commands, upload WAV for its own exams |

## API overview

| Who | Endpoint | What |
| --- | --- | --- |
| all | `POST /api/auth/login`, `POST /api/auth/change-password`, `GET /api/auth/me` | login (429 after 5 wrong passwords), password change (returns a fresh token; older tokens die), who am I |
| admin | `GET/POST /api/admin/doctors`, `POST /api/admin/doctors/{id}/block` · `/unblock` | doctors |
| admin | `GET/POST /api/admin/devices`, `PATCH /api/admin/devices/{id}` | devices, assignment |
| admin | `GET /api/admin/stats`, `GET /api/admin/audit` | counts, audit log |
| doctor | `GET/POST /api/patients`, `GET /api/patients/{id}`, `POST …/consent`, `POST …/login`, `GET …/exams` | patients |
| doctor | `POST /api/exams`, `GET /api/exams/{id}`, `GET /api/exams/{id}/audio`, `PATCH /api/exams/{id}/review` | exams |
| doctor | `GET /api/devices` | own devices with online status |
| patient | `GET /api/me`, `GET /api/me/exams` | own data |
| device | `POST /api/device/heartbeat`, `GET /api/device/command`, `POST /api/device/upload/{exam_id}` | device link |

Exam status: `waiting → recording → uploaded → analyzed → reviewed` (or `failed`).

## Project docs

- [AGENTS.md](AGENTS.md) — project rules (also read by Claude Code)
- [docs/map.md](docs/map.md) — where things live
- [docs/runbook.md](docs/runbook.md) — run, test, migrate
- [docs/decisions/](docs/decisions/) — owner decisions and open assumptions
