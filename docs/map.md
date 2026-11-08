# Code map

Where things live. One line per path, at most ~150 characters, whole file under 15 KB. Behaviour and history are NOT
here: decisions → `docs/decisions/`, how to run / configure / deploy → `docs/runbook.md`.

## Root

- `.interface-design/system.md` — design system: direction, rejected defaults, tokens, type scale, depth, behaviour rules

- `README.md` — what MurMur is, first run, tests, roles, API overview
- `AGENTS.md` — all project rules (Claude reads it through `CLAUDE.md`)
- `CLAUDE.md` — only imports `AGENTS.md`
- `.gitignore` — ignores `.env`, Python caches, `storage/`, `samples/`, `models/` (AI weights, downloaded at setup)
- `.claude/settings.json` — permissions + hook that blocks reading secret files
- `.claude/secret-files.txt` — list of real secret files (`.env`)
- `.claude/hooks/block-secrets.mjs` — the hook itself
- `docker-compose.yml` — PostgreSQL 16 (`db` service), values from `.env`
- `.env.example` — every config key, no real values

## Backend

- `backend/pyproject.toml` — dependencies (uv), pytest config, pure-Python SQLAlchemy setting
- `backend/app/main.py` — `create_app()`: CORS, routers, `/api/health`; serves `frontend/dist` at `/` when built
- `backend/app/upload_limit.py` — ASGI middleware: rejects big/unsized device uploads from Content-Length
- `backend/app/config.py` — `Settings` from env / `.env`; builds the database URL
- `backend/app/db.py` — engine, `SessionLocal`, `Base` (constraint naming), `CreatedAtMixin`, `get_db` dependency
- `backend/app/security.py` — bcrypt passwords, JWT tokens, device API key generation + SHA-256 hash
- `backend/app/deps.py` — auth dependencies: `CurrentUser/Admin/Doctor/Patient`, `CurrentDevice` (X-Device-Key)
- `backend/app/cli.py` — `python -m app.cli create-admin` (first admin from env, idempotent)
- `backend/app/api/auth.py` — login, change-password, `/api/auth/me`
- `backend/app/schemas/` — request/response shapes; `common.py` has password/username field rules
- `backend/app/services/errors.py` — `NotFound`/`Conflict`/`BadRequest`; mapped to HTTP in `main.py`
- `backend/app/services/users.py` — create user, authenticate (equal timing), change/set password (bumps token_version)
- `backend/app/services/login_limiter.py` — in-memory brute-force guard: 5 wrong passwords per (IP, username) / 15 min
- `backend/app/api/admin.py` — `/api/admin/*`: doctors, devices (+ one-time key), stats, audit
- `backend/app/services/doctors.py` — create / list (with patient count) / block doctors, reset a doctor's password
- `backend/app/services/devices.py` — register device + key, rotate key, assign to doctor, list a doctor's devices
- `backend/app/services/stats.py` — admin counts; "today" uses `APP_TIMEZONE`
- `backend/app/services/audit.py` — `record()` a read of patient data, list entries
- `backend/app/api/doctor.py` — `/api/patients/*`, `/api/exams/*`, `/api/devices` (own devices) for the doctor
- `backend/app/services/patients.py` — doctor's own patients: create/edit/delete (erases all), consent, login + reset; audits
- `backend/app/services/exams.py` — doctor's own exams: start, read, audio path, review, cancel; audits reads
- `backend/app/services/exam_flow.py` — the ONLY place exam status changes; allowed transitions table
- `backend/app/services/storage.py` — WAV files on disk as `<uuid>.wav` in `RECORDINGS_DIR`
- `backend/app/api/device.py` — `/api/device/*`: heartbeat, command poll (204 = nothing), WAV upload (202)
- `backend/app/services/device_flow.py` — heartbeat, take next command (row lock), WAV check + save
- `backend/app/services/ai/cardiophon.py` — CardioPHON encoder (BYOL-A port), log-mel, resample, `CardiophonAnalyzer`
- `backend/app/services/analyzer.py` — `Analyzer` interface, `DummyAnalyzer`, `get_analyzer()` (AI_MODEL switch);
  answer vocabulary `ANSWER_LABELS` / `gave_answer()` (mirrored by frontend `aiOutcome.ts`)
- `backend/app/api/patient.py` — `/api/me`, `/api/me/exams` (reviewed only, no AI fields)
- `backend/app/services/patient_portal.py` — patient's own profile and reviewed exams; audits reads
- `backend/app/services/quality.py` — plain signal rules before the AI: duration, silence, clipping, motion
- `backend/app/services/analysis.py` — background job after upload: analyze, store `AIResult`, or mark failed
- `backend/app/models/` — one file per table (8 tables); `enums.py` holds roles, statuses, points; `__init__` imports all
- `backend/alembic.ini`, `backend/alembic/env.py` — Alembic; DB URL comes from app settings, not the ini
- `backend/alembic/versions/` — migrations, numbered `0001_…`
- `backend/tests/conftest.py` — forces `murmur_test`, rebuilds it via migrations per run, empties tables per test
- `backend/tests/test_migrations.py` — tables exist, models match migrations, downgrade/upgrade round trip
- `backend/tests/helpers.py` — `make_user`, `login`, `make_device`, `make_patient`, `make_wav` builders shared by tests
- `backend/tests/test_web_app.py` — built web app served next to the API: client routes, cache, no traversal
- `backend/tests/test_full_flow.py` — the whole story through the API: admin → doctor → device → analysis → review → patient
- `backend/tests/test_access_rules.py` — whose data / which data each role may see (patients, admin, AI fields)

## Docs

- `docs/context.md` — who MurMur is for, where it runs (offline laptop demo), languages, constraints
- `docs/specs/` — feature specs; `mockups/` holds static HTML mockups for design decisions; `screens/` = screenshots of
  the full demo run (1440 / 375 px, uz / ru / en; headless Chrome, 2026-11-08)

- `docs/PLAN.md` — full MVP plan in Uzbek (hardware, AI, roles, weekly plan)
- `docs/map.md` — this file
- `docs/runbook.md` — how to run and test
- `docs/decisions/` — owner's decisions by month
- `docs/glossary.md` — medical terms in uz/ru/en with sources and confidence

## Frontend

- `frontend/package.json` — React 19 + Vite 8 + TypeScript 5.9; scripts: dev, build, test (Vitest), lint (ESLint)
- `frontend/vite.config.ts` — Tailwind plugin, `/api` proxy, vendor chunk, Vitest (jsdom) config
- `frontend/src/index.css` — design tokens (visual system A), bundled fonts, Uzbek okina font fix
- `frontend/eslint.config.js` — ESLint (oxlint is blocked by Smart App Control)
- `frontend/scripts/check-offline.mjs` — `npm run check:offline`: fails if the build would load anything from the internet
- `frontend/src/main.tsx` — entry: CSS, i18n, `<App/>`
- `frontend/src/app/App.tsx` — data router, role pages lazy-loaded, QueryClient (retries only network/5xx),
  ForgetDataOnUserChange (cache cleared + pages remounted when the user changes)
- `frontend/src/app/session.ts` — token + role in sessionStorage; `useSession()`; why the session ended
- `frontend/src/app/guards.tsx` — `RequireRole`, `RequireSession`, `HomeRedirect`, safe `?next=`
- `frontend/src/api/client.ts` — `api()`: Bearer token, 401 → session expired, 403 → change password; `errorMessage()`
- `frontend/src/api/auth.ts` — login, change password, me
- `frontend/src/i18n/` — uz/ru/en JSON, auto-detect (`detect.ts`), `changeLanguage()`; test checks key parity and `ʻ`
- `frontend/src/components/ui/` — Button (busy = double-click guard), TextField, Alert
- `frontend/src/components/brand/` — Logo, ChartTrace (millimetre grid signature); `src/lib/heart.ts` synthetic trace
- `frontend/src/components/layout/` — AppShell (header, role nav, account menu), AuthLayout (login frame)
- `frontend/src/pages/` — Login, ChangePassword, status pages (not available / not found)
- `frontend/src/api/doctor.ts` — doctor endpoints + types (patients, exams list, devices, logins)
- `frontend/src/lib/format.ts` — dates (Asia/Tashkent), relative time, numbers per language, age
- `frontend/src/components/ui/` — also Dialog (Radix), SecretDialog (one-time secrets), States (empty/error/skeleton/panel)
- `frontend/src/components/exam/StatusMark.tsx` — exam status as mini trace + word
- `frontend/src/components/device/OnlineBadge.tsx` — online dot + word (doctor and admin pages)
- `frontend/src/components/exam/ChestDiagram.tsx` — chest outline + 4 points (shared: doctor picker, patient map)
- `frontend/src/features/doctor/` — DoctorHome (review queue), `patients/` list, form, patient page; `shared.tsx`
  (RecordNo, PointLabel, useOneTimeState for once-only banners)
- `frontend/src/features/doctor/exam/` — NewExamPage (device + ChestPointPicker), ExamPage (live), `liveState.ts`
  (status → screen state, polling speed, backend failure text → i18n keys); ResultView (AI card, review form,
  saved conclusion), HeartStrip (wavesurfer on chart paper, close-up, spectrogram), `aiOutcome.ts`
- `frontend/src/api/admin.ts`, `frontend/src/features/admin/` — AdminHome (counts, devices, AI model), DoctorsPage,
  DevicesPage (key shown once, assign, rotate), AuditPage (pages of 50, action filter in the URL)
- `frontend/src/api/patient.ts`, `frontend/src/features/patient/` — patient phone pages: PatientHome (reviewed results),
  ResultPage (doctor's conclusion + where listened); never any AI field
- `frontend/src/test/utils.tsx` — fake backend + `renderAt()` for page tests

## Scripts

- `scripts/fake_device.py` — simulated device (stdlib only): heartbeat, poll, upload a WAV; firmware reference
- `firmware/murmur/` — ESP32-S3 Arduino firmware: `murmur.ino` (loop), `audio.h` (I2S mic → 16 kHz WAV), `net.h`
  (Wi-Fi + device API), `config.h` (pins, rates, gain), `secrets.example.h` (copy to gitignored `secrets.h`)
- `scripts/ai/` — CirCor labels + split (`circor.py`), shared training/metrics (`learn.py`), `experiment.py` (5-fold CV →
  `docs/specs/ai-experiments.md`), `train_head.py` (final head + threshold), `evaluate.py` (→ `docs/specs/ai-results.md`)
