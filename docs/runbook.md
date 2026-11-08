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
```

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
