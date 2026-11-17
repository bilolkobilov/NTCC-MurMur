# Code map

Where things live. One line per path, at most ~150 characters, whole file under 15 KB. Behaviour and history are NOT
here: decisions → `docs/decisions/`, how to run / configure / deploy → `docs/runbook.md`.

## Root

- `.interface-design/system.md` — design system: direction, rejected defaults, tokens, type scale, depth, behaviour rules

- `README.md` — what MurMur is, first run, tests, roles, API overview
- `AGENTS.md` — all project rules (Claude reads it through `CLAUDE.md`)
- `CLAUDE.md` — imports `AGENTS.md`; adds commands and cross-file architecture notes for Claude
- `.gitignore` — ignores `.env`, Python caches, `storage/`, `samples/`, `models/` (AI weights, downloaded at setup)
- `.claude/settings.json` — permissions + hook that blocks reading secret files
- `.claude/secret-files.txt` — list of real secret files (`.env`, `firmware/murmur/secrets.h`)
- `.claude/hooks/block-secrets.mjs` — the hook itself
- `.claude/rules/` — area rules for AI assistants: `firmware.md` (GPIO48, pins, upload layout), `ecg.md` (doctor-only, never
  fails an exam, mirrored codes)
- `docker-compose.yml` + `backend/Dockerfile` — PRODUCTION: `db` + `api` (backend, web app, AI weights mounted from
  `models/`); secrets required from `.env`, no demo data
- `docker-compose.demo.yml` + `backend/Dockerfile.demo` — DEMO (own project name `murmur-demo`): adds the `device`
  (fake device) service and bakes in `demo/`; works with no `.env`
- `.dockerignore` — keeps `.env`, `models/`, `samples/`, `storage/` out of the images
- `demo/` — what the demo image ships: `cardiophon/` (AI weights) and `sample_av.wav` (one CirCor recording)
- `.env.example` — every config key, no real values

## Backend

- `backend/README.md` — backend: run, tests, layout, rules, API overview
- `backend/pyproject.toml` — dependencies (uv), pytest config, pure-Python SQLAlchemy setting
- `backend/app/main.py` — `create_app()`: CORS, routers, `/api/health`; serves `frontend/dist` at `/` when built
- `backend/app/upload_limit.py` — ASGI middleware: rejects big/unsized device uploads from Content-Length
- `backend/app/config.py` — `Settings` from env / `.env`; builds the database URL
- `backend/app/db.py` — engine, `SessionLocal`, `Base` (constraint naming), `CreatedAtMixin`, `get_db` dependency
- `backend/app/security.py` — bcrypt passwords, JWT tokens, device API key generation + SHA-256 hash
- `backend/app/deps.py` — auth dependencies: `CurrentUser/Admin/Doctor/Patient`, `CurrentDevice` (X-Device-Key)
- `backend/app/cli.py` — `python -m app.cli create-admin` (first admin from env, idempotent)
- `backend/app/api/auth.py` — login (doctor/patient), admin login (`/api/auth/admin/login`), change-password, `/api/auth/me`
- `backend/app/schemas/` — request/response shapes; `common.py` has password/username field rules
- `backend/app/services/errors.py` — `NotFound`/`Conflict`/`BadRequest`; mapped to HTTP in `main.py`
- `backend/app/services/users.py` — create user, authenticate (equal timing), change/set password (bumps token_version)
- `backend/app/services/login_limiter.py` — in-memory brute-force guard: 5 wrong passwords per (IP, username) / 15 min
- `backend/app/api/admin.py` — `/api/admin/*`: doctors, devices (+ one-time key), stats, audit
- `backend/app/services/doctors.py` — create / list / edit / block doctors, reset password; profile (workload counts,
  devices), admin's patient list, activity
- `backend/app/services/devices.py` — register device + key, rotate key, assign, disconnect / reconnect (with reason),
  self-test request, device audit trail
- `backend/app/services/device_health.py` — pure: device state (pending/online/offline/disconnected), health checks and overall health
- `backend/app/services/stats.py` — admin counts; "today" uses `APP_TIMEZONE`
- `backend/app/services/audit.py` — `record()` a read of patient data, list entries
- `backend/app/api/doctor.py` — `/api/patients/*`, `/api/exams/*`, `/api/devices` (own devices) for the doctor
- `backend/app/services/patients.py` — doctor's own patients: create/edit/delete (erases all), consent, login + reset; audits
- `backend/app/services/result_status.py` — pure: latest exam + AI answer → registry status (normal/abnormal/pending/failed/reviewed), priority rank
- `backend/app/services/exams.py` — doctor's own exams: start, read, audio path, review, cancel; audits reads
- `backend/app/services/exam_flow.py` — the ONLY place exam status changes; allowed transitions table
- `backend/app/services/storage.py` — WAV files on disk as `<uuid>.wav` in `RECORDINGS_DIR`
- `backend/app/api/device.py` — `/api/device/*`: heartbeat, command poll (204 = nothing), WAV upload (202)
- `backend/app/services/device_flow.py` — heartbeat, take next command (row lock), WAV check + save
- `backend/app/services/ai/cardiophon.py` — CardioPHON encoder (BYOL-A port), log-mel, resample, `CardiophonAnalyzer`
- `backend/app/services/analyzer.py` — `Analyzer` interface, `DummyAnalyzer`, `get_analyzer()` (AI_MODEL switch);
  answer vocabulary `ANSWER_LABELS` / `gave_answer()` (mirrored by frontend `aiOutcome.ts`)
- `backend/app/api/patient.py` — `/api/me` (GET, PATCH contact details), `/api/me/exams` (reviewed only, AI label but no score)
- `backend/app/services/patient_portal.py` — patient's own profile, contact edit, reviewed exams, recording; audits reads and edits
- `backend/app/services/ecg.py` — single-lead ECG (pure Python): decode device bytes, filter, R peaks, heart rate, quality,
  channel choice, the doctor's strip; loads the optional rhythm model
- `backend/app/services/ai/ecg_rhythm.py` — ECG rhythm model (1-D ResNet, "AF suspected"): preprocessing, `load()`,
  `predict()`; weights + threshold in `models/ecg/`
- `backend/app/models/ecg.py` — `EcgRecording` (the `.ecg` file next to the WAV) and `EcgResult` (what was measured)
- `backend/app/services/quality.py` — plain signal rules before the AI: duration, silence, clipping, motion
- `backend/app/services/analysis.py` — background job after upload: analyze, store `AIResult`, or mark failed
- `backend/app/models/` — one file per table (11 tables); `enums.py` holds roles, statuses, points; `__init__` imports all
- `backend/alembic.ini`, `backend/alembic/env.py` — Alembic; DB URL comes from app settings, not the ini
- `backend/alembic/versions/` — migrations, numbered `0001_…`
- `backend/tests/conftest.py` — forces `murmur_test`, rebuilds it via migrations per run, empties tables per test
- `backend/tests/test_result_status.py` — every row of the registry status mapping
- `backend/tests/test_migrations.py` — tables exist, models match migrations, downgrade/upgrade round trip
- `backend/tests/helpers.py` — `make_user`, `login`, `make_device`, `make_patient`, `make_wav` builders shared by tests
- `backend/tests/test_web_app.py` — built web app served next to the API: client routes, cache, no traversal
- `backend/tests/test_full_flow.py` — the whole story through the API: admin → doctor → device → analysis → review → patient
- `backend/tests/test_device_health.py` — health rules and the admin device API: telemetry, disconnect, self-test, activity
- `backend/tests/test_access_rules.py` — whose data / which data each role may see (patients, admin, AI fields)

## Docs

- `docs/context.md` — who MurMur is for, where it runs (offline laptop demo), languages, constraints
- `docs/specs/` — feature specs and AI results; `mockups/` static HTML mockups; `screens/` v2 screenshots (en, 375 / 1440 px,
  headless Chrome, 2026-11-17)

- `docs/PLAN.md` — full MVP plan in Uzbek (hardware, AI, roles, weekly plan)
- `docs/map.md` — this file
- `docs/runbook.md` — how to run and test
- `docs/decisions/` — owner's decisions by month
- `docs/glossary.md` — medical terms in uz/ru/en with sources and confidence

## Frontend

- `frontend/README.md` — frontend: run, checks, layout, rules
- `frontend/package.json` — React 19 + Vite 8 + TypeScript 5.9; scripts: dev, build, test (Vitest), lint (ESLint)
- `frontend/vite.config.ts` — Tailwind plugin, `/api` proxy, vendor chunk, Vitest (jsdom) config
- `frontend/src/index.css` — the one palette (`@theme`, petrol blue + chart paper), bundled fonts, Uzbek okina font fix
- `frontend/eslint.config.js` — ESLint (oxlint is blocked by Smart App Control)
- `frontend/scripts/check-offline.mjs` — `npm run check:offline`: fails if the build would load anything from the internet
- `frontend/src/redesign/` — the redesign palette (`tokens.css`), `rd-` component styles, components and icons used by the
  shells and most pages (being merged into one design system in v2)
- `frontend/src/main.tsx` — entry: CSS, i18n, `<App/>`
- `frontend/src/app/App.tsx` — data router, role pages lazy-loaded, QueryClient (retries only network/5xx),
  ForgetDataOnUserChange (cache cleared + pages remounted when the user changes)
- `frontend/src/app/session.ts` — token + role in sessionStorage; `useSession()`; why the session ended
- `frontend/src/app/guards.tsx` — `RequireRole`, `RequireSession`, `HomeRedirect`, safe `?next=`
- `frontend/src/api/client.ts` — `api()`: Bearer token, 401 → session expired, 403 → change password; `errorMessage()`
- `frontend/src/api/auth.ts` — login (role card), admin login, change password, me
- `frontend/src/components/auth/AuthControls.tsx` — controls of the redesigned sign-in card (field with eye, alert, small segmented, logo)
- `frontend/src/i18n/` — uz/ru/en JSON, auto-detect (`detect.ts`), `changeLanguage()`; test checks key parity and `ʻ`
- `frontend/src/components/ui/` — Button and Alert (thin wrappers over the redesign ones), TextField
- `frontend/src/components/layout/` — PatientShell (left sidebar + header, phone tab bar, `patient.css` for all
  patient pages), AuthLayout (login frame)
- `frontend/src/pages/` — Login, ChangePassword, status pages (not available / not found)
- `frontend/src/api/doctor.ts` — doctor endpoints + types (patients, exams list, devices, logins)
- `frontend/src/lib/format.ts` — dates (Asia/Tashkent), relative time, numbers per language, age
- `frontend/src/components/ui/` — also Dialog (Radix), SecretDialog (one-time secrets), States (empty/error/skeleton/panel)
- `frontend/src/components/exam/StatusMark.tsx` — exam status as mini trace + word
- `frontend/src/components/device/OnlineBadge.tsx` — online dot + word (doctor and admin pages)
- `frontend/src/components/exam/ChestDiagram.tsx` — chest outline + 4 points (shared: doctor picker, patient map)
- `frontend/src/components/layout/AppFrame.tsx` — doctor/admin frame: sidebar, header, footer; below 900 px a bottom tab bar
- `frontend/src/components/layout/DoctorShell.tsx` — doctor's navigation and menu on `AppFrame`
- `frontend/src/features/doctor/` — `patients/` PatientRegistry (the doctor's main page), PatientFormPage (new / edit,
  "Patient created" dialog), PatientPage (`/doctor/patients/:id`: AI flag, VitalsCard (vital signs as plain numbers,
  record dialog), identity, overview / recordings tabs, device, details, consent, login, delete); `shared.tsx`
  (RecordNo, PointLabel, useOneTimeState for once-only banners)
- `frontend/src/features/doctor/exam/` — NewExamPage (device + ChestPointPicker), ExamPage (live), `liveState.ts`
  (status → screen state, polling speed, backend failure text → i18n keys); ResultView (AI card, review form, EcgStrip
  (ECG card + strip, `ecgOutcome.ts`),
  saved conclusion), HeartStrip (wavesurfer on chart paper, close-up, spectrogram), `aiOutcome.ts`
- `frontend/src/api/admin.ts`, `frontend/src/features/admin/` — AdminHome (counts, devices, AI model), DoctorsPage
  (summary, filters, status tabs, table),
  DoctorProfilePage (`/admin/doctors/:id`: edit, block, reset), `doctorDialogs.tsx`, DoctorFormPage
  (`/admin/doctors/new`: details → credentials shown once), `doctorFields.tsx` (password field + generator),
  DevicesPage (fleet summary, filters in the URL, table, Details opens the device page), DeviceFormPage
  (`/admin/devices/new`: details → key shown once),
  DeviceDetailPage (`/admin/devices/:id`: network, checks, self-test, disconnect/reconnect, assign, new key),
  `deviceUi.tsx` (chips, filters, masks), AuditPage (pages of 50, action filter in the URL)
- `frontend/src/features/profile/` — `DoctorProfileView` (one profile page for the admin and the doctor), `MyProfilePage` (`/doctor/profile`)
- `frontend/src/components/layout/AdminShell.tsx` — admin's navigation and menu on `AppFrame`
- `frontend/src/api/patient.ts`, `frontend/src/features/patient/` — patient pages: ResultsPage (latest visit, positions,
  earlier visits, note on the right), ProfilePage (clinic data + editable contact), RecordsPage (printable), `visits.ts`; no AI score
- `frontend/src/test/utils.tsx` — fake backend + `renderAt()` for page tests

## Scripts

- `scripts/fake_device.py` — simulated device (stdlib only): heartbeat, poll, upload a WAV + synthetic ECG; firmware reference
- `firmware/README.md` — the device guide: wiring, GPIO48 / RGB LED, ECG electrodes, flashing, troubleshooting
- `firmware/murmur/` — ESP32-S3 Arduino firmware: `murmur.ino` (loop), `audio.h` (I2S mic → 16 kHz WAV), `ecg.h`
  (ADS1292R ECG, recorded with the sound), `net.h` (Wi-Fi + device API), `config.h` (pins, rates, gain),
  `secrets.example.h` (copy to gitignored `secrets.h`)
- `scripts/ai/README.md` — AI model: how it works, results, setup, train / evaluate
- `scripts/ai/ecg/` — ECG rhythm model: download (CinC 2017, PTB-XL subset), readers, committed split, train, evaluate
  (→ `docs/specs/ecg-ai-results.md`)
- `scripts/ai/` — CirCor labels + split (`circor.py`), shared training/metrics (`learn.py`), `experiment.py` (5-fold CV →
  `docs/specs/ai-experiments.md`), `train_head.py` (final head + threshold), `evaluate.py` (→ `docs/specs/ai-results.md`)
