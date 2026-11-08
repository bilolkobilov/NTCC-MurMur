# Runbook

How to run, configure, test and deploy. Facts only, key names never values.

## Setup

- Python 3.14 is installed through the Python Install Manager; use `py`, not `python` (the `python` command opens the Store alias).
- uv is installed with `py -m pip install --user uv`; its folder `%APPDATA%\Python\Python314\Scripts` is on the user PATH.
- Docker Desktop must be running before the database starts.
- Config: copy `.env.example` to `.env` and replace every `change-me` with a random value. Keys are listed in `.env.example`.
- Windows Smart App Control is ON and blocks unsigned `.exe` launchers in `.venv/Scripts` and some compiled DLLs.
  So: always run tools as `uv run python -m <tool>` (never `uv run pytest`), and SQLAlchemy is built as pure Python
  (`backend/pyproject.toml`, `[tool.uv]`). A new compiled dependency may be blocked the same way — test its import first.

## Run locally

```bash
docker compose up -d db                 # PostgreSQL 16, waits for "healthy"
cd backend
uv sync                                 # install dependencies into backend/.venv
uv run python -m alembic upgrade head   # create / update tables
uv run python -m app.cli create-admin   # first admin from FIRST_ADMIN_* keys; safe to run again
uv run python -m uvicorn app.main:app --reload   # API on http://localhost:8000, docs at /docs
```

## Checks

```bash
cd backend
uv run python -m pytest                 # uses the separate murmur_test database, created automatically
uv run python -m ruff check . ../scripts         # lint (unused code, import order, likely bugs)
uv run python -m ruff format . ../scripts        # auto-format; use --check to only verify
```

## Frontend (development)

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173, /api is proxied to the backend on :8000
npm test           # Vitest
npm run lint       # ESLint
npm run build      # type-check + production build into frontend/dist
```

TypeScript is pinned to ~5.9 and linting uses ESLint on purpose: TypeScript 7 / oxlint use native binaries that
Smart App Control blocks or that ESLint cannot use (see docs/decisions/2026-11.md).

## Demo mode (one process, offline laptop)

```bash
cd frontend && npm run build        # creates frontend/dist
cd ../backend && uv run python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Open http://localhost:8000 — FastAPI serves the web app and the API from one origin (no CORS). The device on the
hotspot talks to http://<laptop-ip>:8000/api/device/... . `FRONTEND_DIST` can point elsewhere; if the folder has no
`index.html`, only the API runs.

## Manual test without hardware (fake device)

1. Start the API (above). As admin, register a device assigned to a doctor; copy the one-time `api_key`.
2. In a second terminal, give the key through an env var (not a command argument) and start the fake device:

```powershell
$env:MURMUR_DEVICE_KEY="<the key>"
py scripts/fake_device.py --samples samples/        # or --wav path\to\file.wav; add --once --fast for one quick run
```

3. As the doctor, start an exam on that device (`POST /api/exams`). The fake device picks up the command, waits the
   recording time, uploads the next WAV, and the exam moves to `analyzed`.

Sample WAVs go in `samples/` (gitignored). Heart sounds from the CirCor DigiScope dataset (PhysioNet, ODC-BY 1.0):
cite it if results are shown in the report.

## Database migrations

```bash
cd backend
uv run python -m alembic revision --autogenerate -m "what changed" --rev-id 0002   # after changing a model; review the file
uv run python -m alembic upgrade head      # apply
uv run python -m alembic downgrade -1      # roll back the last migration
```

`tests/test_migrations.py` fails if a model was changed without a migration.

## Deploy and rollback

Not documented — ask the owner. (Plan: version 1 runs on a laptop + hotspot, version 2 on a server with HTTPS.)
