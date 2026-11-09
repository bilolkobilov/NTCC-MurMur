# MurMur

Portable heart-sound screening: an ESP32-S3 device records ~20 s of heart sound, the backend stores it and runs a
local AI analyzer, and doctors review the result. Research prototype and screening aid — **not a medical device**.

Built so far: backend (FastAPI + PostgreSQL), web app for admin / doctor / patient (React, uz / ru / en, phone and
laptop), and a local AI murmur model (CardioPHON encoder + our head, `cardiophon-murmur 1.1.0`; results in
[docs/specs/ai-results.md](docs/specs/ai-results.md)). The ESP32 firmware comes next; until then
`scripts/fake_device.py` plays the device with CirCor recordings. Full plan in Uzbek: [docs/PLAN.md](docs/PLAN.md).

Source: <https://github.com/bilolkobilov/NTCC-MurMur> (private). Not in Git on purpose: `.env`, AI weights
(`models/`), CirCor recordings (`samples/`), device secrets (`firmware/murmur/secrets.h`) — see
[docs/runbook.md](docs/runbook.md).

## Docker demo (nothing to install or download)

Needs only Docker. The `demo/` folder already holds the pretrained AI weights and one sample heart sound, and the
`device` service is a simulated IoT device, so the whole chain works out of the box:

```bash
docker compose -f docker-compose.demo.yml up --build       # first build takes a few minutes (web app + CPU PyTorch)
```

Open <http://localhost:8000> (port busy? `API_PORT=8010 docker compose -f docker-compose.demo.yml up --build`).

| Login | Username | Password |
| --- | --- | --- |
| Admin | `admin` | `admin-demo-1` |
| Doctor | `doctor` | `doctor-demo-1` |

As the doctor: add a patient (tick consent) → new exam on "Demo device" → within seconds the device uploads
`demo/sample_av.wav` and the AI result appears. The demo values are fixed in `docker-compose.demo.yml` and a `.env` file does not affect them. `docker compose -f docker-compose.demo.yml down -v` also deletes the demo data.

**Production** is the separate `docker-compose.yml` + `backend/Dockerfile`: no demo data or fake device, every secret
must be set in `.env` (compose refuses to start otherwise), AI weights are mounted from `./models`, and the
database port is bound to 127.0.0.1 only. Run `docker compose up -d --build`.

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

## Run the demo (one laptop, no internet)

```bash
docker compose up -d db
cd frontend && npm install && npm run build      # the web app, served by the backend
cd ../backend && uv sync                         # includes PyTorch for the AI (group "ai")
uv run python -m alembic upgrade head
uv run python -m app.cli create-admin
uv run python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Open <http://localhost:8000>. The AI model files must be in `models/` and `AI_MODEL=cardiophon` in `.env`
(how: [docs/runbook.md](docs/runbook.md), "AI model"); without them every exam says "No AI opinion".

Demo script (≈ 5 minutes, checked end to end on 2026-11-08):
1. **Admin** — Doctors → *Add doctor* (generate a password, hand it over) → Devices → *Register device*, assign it
   to the doctor, copy the key (shown once).
2. **Device** — `MURMUR_DEVICE_KEY=<key> py scripts/fake_device.py --samples samples/circor/<…>/training_data/`
   (the real ESP32 later). The device shows *Online* within 10 s.
3. **Doctor** — *Add patient* (tick signed consent) → *Create login* (one-time password) → *Start exam*: device +
   point on the chest diagram → watch the 20 s recording live → result: listen, waveform / spectrogram, AI card →
   agree / disagree + conclusion → *Confirm review*.
4. **Patient (phone)** — log in with the one-time password → choose own password → *Your results* → the doctor's
   conclusion and where the doctor listened. No AI wording for patients.
5. **Admin** — Overview (exams today, AI model) and the audit log of every read of patient data.

## Tests

```bash
cd backend
uv run python -m pytest
cd ../frontend
npm test                # Vitest: pages, flows, languages (same keys, plurals, Uzbek script)
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
| admin | `GET/POST /api/admin/doctors`, `POST /api/admin/doctors/{id}/block` · `/unblock` · `/password` | doctors, password reset |
| admin | `GET/POST /api/admin/devices`, `PATCH /api/admin/devices/{id}`, `POST …/rotate-key` | devices, assignment, new key |
| admin | `GET /api/admin/stats`, `GET /api/admin/audit` | counts, audit log |
| doctor | `GET/POST /api/patients`, `GET/PATCH/DELETE /api/patients/{id}`, `POST …/consent`, `POST …/login`, `POST …/reset-password`, `GET …/exams` | patients (delete erases everything) |
| doctor | `POST /api/exams`, `GET /api/exams/{id}`, `GET …/audio`, `PATCH …/review`, `POST …/cancel` | exams |
| doctor | `GET /api/devices` | own devices with online status |
| patient | `GET /api/me`, `GET /api/me/exams` | own data |
| device | `POST /api/device/heartbeat`, `GET /api/device/command`, `POST /api/device/upload/{exam_id}` | device link |

Exam status: `waiting → recording → uploaded → analyzed → reviewed` (or `failed`: cancelled, analysis error, or
a "re-record" quality problem — too short, almost silent, clipped, or movement).
Review body: `{"note": "...", "agrees_with_ai": true|false}` when the AI answered (label `murmur` / `absent`);
without `agrees_with_ai` when it gave no answer (`not_analyzed`, or quality `bad`).

## Project docs

- [AGENTS.md](AGENTS.md) — project rules (also read by Claude Code)
- [docs/map.md](docs/map.md) — where things live
- [docs/runbook.md](docs/runbook.md) — run, test, migrate
- [docs/decisions/](docs/decisions/) — owner decisions and open assumptions
