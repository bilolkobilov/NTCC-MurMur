# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

Rules, roles, stack and the "definition of done" live in AGENTS.md (imported above). `docs/map.md` says where each file
is and `docs/runbook.md` has the full setup, AI-model and firmware steps. Below: only what those do not give you.

## Commands

Run Python tools as `uv run python -m <tool>` (never `uv run pytest` / bare `ruff`): the runbook documents a Windows
Smart App Control issue with `.exe` launchers, and the `-m` form is the project convention everywhere.

```bash
docker compose up -d db                              # PostgreSQL 16 (required, also for tests)
cd backend && uv sync
uv run python -m alembic upgrade head
uv run python -m app.cli create-admin                # first admin from FIRST_ADMIN_* env keys
uv run python -m uvicorn app.main:app --reload       # API :8000, /docs

uv run python -m pytest                              # whole suite (auto-creates/migrates `murmur_test`)
uv run python -m pytest tests/test_access_rules.py -k patient   # one file / one test
uv run python -m ruff check . ../scripts && uv run python -m ruff format --check . ../scripts

cd ../frontend && npm run dev                        # :5173, proxies /api to :8000
npx tsc -b && npm run lint && npm test && npm run build && npm run check:offline
npx vitest run src/path/to/file.test.tsx             # one frontend test file
```

After changing a model: `uv run python -m alembic revision --autogenerate -m "..." --rev-id 000N` and review it —
`tests/test_migrations.py` fails if models and migrations drift. Tests run against Postgres only (no SQLite);
`conftest.py` forces the `murmur_test` database and empties tables between tests.

## Architecture (the parts that span files)

- **One origin in demo mode.** `app/main.py` serves `frontend/dist` at `/` next to `/api`, so the offline laptop demo
  has no CORS. The frontend must not load anything from the internet (`npm run check:offline` enforces it); fonts are bundled.
- **Layering.** `api/` routers are thin and only declare role dependencies from `deps.py` (`CurrentAdmin/Doctor/Patient`,
  `CurrentDevice`); business rules and audit writes live in `services/`. Services raise `NotFound`/`Conflict`/`BadRequest`
  (`services/errors.py`), which `main.py` maps to HTTP.
- **Exam lifecycle is centralised.** `services/exam_flow.py` is the only place an exam's status changes (transitions
  table). Never set `exam.status` elsewhere.
- **Device round trip.** Doctor `POST /api/exams` → a `device_commands` row → device polls `GET /api/device/command`
  (204 = nothing; row-locked so a command is handed out once) → device uploads a WAV (`upload_limit.py` middleware rejects
  missing/oversized `Content-Length` before the body is read) → `services/analysis.py` runs as a BackgroundTask:
  `quality.py` rules first, then the `Analyzer` from `get_analyzer()`, storing an `AIResult` with model name + version.
  `scripts/fake_device.py` and `firmware/murmur/` implement the same protocol.
- **AI answer vocabulary is mirrored.** `analyzer.py` (`ANSWER_LABELS`, `gave_answer()`) is mirrored by the frontend
  `features/doctor/exam/aiOutcome.ts`; change both together. `AI_MODEL=dummy` is the default and the fallback when
  weights in `models/cardiophon/` are missing.
- **Access control is data-shaped, not only route-shaped.** Admin sees counts, never medical data; doctors see only their
  patients; patients get `reviewed` exams with the AI yes / no label but no score / model / agreement (`patient_portal.py`). `tests/test_access_rules.py` and
  `tests/test_full_flow.py` pin this — extend them with any new endpoint. Reads of patient data go through
  `audit.record_read` (deduped per user/record per 5 min).
- **Auth details.** A password change bumps `token_version` (invalidates old JWTs); login is rate-limited in memory
  (`login_limiter.py`); device keys are shown once and stored as SHA-256 hashes.
- **Frontend.** Role-split lazy pages under `src/features/{admin,doctor,patient}`; all server access goes through
  `src/api/client.ts` (Bearer token in sessionStorage, 401 → session expired, 403 → forced password change).
  Every string needs uz / ru / en keys (a test checks parity), and Uzbek text uses the `ʻ` okina.

## Housekeeping

- Structure changes also update `docs/map.md`; new owner decisions go in `docs/decisions/`.
- The runbook's shell snippets are Windows-oriented (`py`, PowerShell); on macOS use the `uv` / `python3` equivalents.
