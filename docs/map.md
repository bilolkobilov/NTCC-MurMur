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
- `backend/app/models/` — one file per table (8 tables); `enums.py` holds roles, statuses, points; `__init__` imports all
- `backend/alembic.ini`, `backend/alembic/env.py` — Alembic; DB URL comes from app settings, not the ini
- `backend/alembic/versions/` — migrations, numbered `0001_…`
- `backend/tests/conftest.py` — forces `murmur_test`, rebuilds it via migrations per run, empties tables per test
- `backend/tests/test_migrations.py` — tables exist, models match migrations, downgrade/upgrade round trip

## Docs

- `docs/PLAN.md` — full MVP plan in Uzbek (hardware, AI, roles, weekly plan)
- `docs/map.md` — this file
- `docs/runbook.md` — how to run and test
- `docs/decisions/` — owner's decisions by month

## Not built yet (Stage 1 adds these; move a line up when it exists)

- backend/app/schemas, api, services — data shapes, routers, business rules
- scripts/fake_device.py — simulated device
