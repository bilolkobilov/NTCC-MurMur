# Repository doimiy qoidalari

Bu qoidalar repositorydagi barcha tasklarga tatbiq qilinadi.

## Qayerdan boshlash

- `docs/map.md` — qaysi narsa qayerda turadi (kichik fayl, to'liq o'qish mumkin).
- `docs/runbook.md` — ishga tushirish, config, testlar, deploy.
- `docs/decisions/` — egasining qarorlari, oy bo'yicha, eng yangisi tepada.
- `docs/PLAN.md` — to'liq MVP rejasi (o'zbekcha). Shu fayl bilan zid kelsa, AGENTS.md ustun.

## Fayl tozaligi

- Har task oxirida vaqtinchalik script, bir martalik probe/diagnostika, eskirgan hujjat va ishlatilmaydigan draftni o'chir.
- "Keyin kerak bo'lar" deb keraksiz fayl saqlanmaydi; kerak bo'lsa Git tarixidan olinadi.
- Foydalanuvchining taskga aloqasiz fayllari va o'zgarishlarini saqla.
- Strukturani o'zgartirgan commit `docs/map.md` ni ham yangilaydi; egasining yangi qarori `docs/decisions/` ga yoziladi.

## Secretlar

- Real secretli fayllar ro'yxati: `.claude/secret-files.txt` (hook ularni o'qishni to'sadi).
- Namuna fayl: `.env.example` — yangi kalit avval shu yerga qo'shiladi.
- Secret qiymatini hech qachon o'qima, chiqarma, log/commit/hisobotga yozma. Faqat kalit nomi yoki `<set>` / `<missing>`.

## Taxmin qilmaslik

- Endpoint, provider formati, secret yoki reference qiymatini o'ylab topma.
- Pul, ruxsat yoki foydalanuvchi ma'lumoti bo'yicha biznes qoidani o'ylab topma — so'ra.
- Ishonchli manba yetishmasa xavfsiz qismini tugat, blokatorni aniq yoz va kerakli qiymatni so'ra.

## Repository shakli

- `backend/` — FastAPI app (`app/`: `api/` routers, `schemas/`, `models/`, `services/`), Alembic, pytest tests.
- `scripts/fake_device.py` — simulated device while there is no hardware; `samples/` — sample WAVs (gitignored).
- `docker-compose.yml` — PostgreSQL only. Frontend and firmware come in later stages.
- Layered, not flattened: routers stay thin, business rules live in `services/`. "Small" means fewer features, not fewer layers.
- Yangi narsa faqat hozir kerak bo'lsa quriladi ("biz enterprise emasmiz") — eng kichik variant.

## Ishni tugatish

- Tugadi deyishdan oldin dalil: `cd backend && uv run python -m pytest` natijasi (hammasi yashil, 0 ta test emas) va
  `uv run python -m ruff check . ../scripts` + `uv run python -m ruff format --check . ../scripts` toza.
- Deploy faqat egasi kelishgan bitta paket bilan, oxirida bitta marta.

---

# MurMur — project rules

## What this is
NTCC university project (B.Tech CSE): a portable heart-sound screening device (ESP32-S3 + I2S microphone)
that records ~20 s of heart sound, sends it to our backend, where a local AI model analyzes it, and doctors
see results on a website. Research prototype and screening aid, NOT a medical device.

## Stack (fixed — ask before changing anything here)
- Python 3.14 (owner's installed Python, run via `py`), FastAPI, SQLAlchemy 2.0 (sync, psycopg 3), Alembic,
  Pydantic v2 + pydantic-settings
- Auth: PyJWT access tokens, bcrypt password hashing
- Database: PostgreSQL 16 via Docker Compose, from day one. No SQLite anywhere, including tests.
- Tests: pytest + FastAPI TestClient against a separate Postgres test database (`murmur_test`)
- Package manager: uv
- Frontend (React + Vite) and firmware (Arduino, ESP32-S3) are NOT part of the current stage.

## Roles and access rules (must be enforced AND covered by tests)
- **No public signup.** The first admin is created with a CLI command using values from env.
- Everyone logs in with a `username` (not email). Any logged-in user can change their own password.
- **admin**: creates and blocks doctors; manages devices (on create, generate an API key, show it once,
  store only its hash; assign device to a doctor); sees system stats and the audit log.
  Admin does NOT see patients' medical data (recordings, AI results, doctor notes), only counts.
- **doctor**: created by admin, who sets the password (no forced change). Creates patients and a login for
  each patient (temporary password shown once; patient must change it on first login). Sees ONLY their own
  patients. Creates exams on devices assigned to them, adds a note + agree/disagree with the AI, and marks
  an exam as `reviewed`.
- **patient**: created by a doctor. Sees ONLY their own profile and their own exams with status `reviewed`
  (including the doctor's note). Never sees unreviewed or raw AI results, never sees other patients.
- **device**: authenticates with header `X-Device-Key`. Can only send heartbeats, poll its own commands,
  and upload audio for exams assigned to it.

## Data model
Tables: `users` (role: admin/doctor/patient), `devices`, `patients` (linked to a doctor and to a patient
user), `exams`, `recordings`, `ai_results`, `device_commands`, `audit_logs`. Field details: PLAN.md section 4.

- Exam status flow: `waiting → recording → uploaded → analyzed → reviewed` (or `failed`).
- Auscultation point per exam: one of `AV`, `PV`, `TV`, `MV`.
- An exam cannot be created if the patient has no recorded consent (`consent_given_at` is null).
- Every AI result stores the model name and model version.

## Device flow
- `POST /api/device/heartbeat` — every ~10 s: firmware version, Wi-Fi RSSI. Updates `last_seen_at`;
  a device is "online" if seen in the last 30 s.
- `GET /api/device/command` — device polls every 1–2 s; returns the pending command (e.g. record 20 s for exam X) or nothing.
- `POST /api/device/upload/{exam_id}` — multipart: `audio` (WAV) + `meta` (JSON: sample rate, motion flag, etc.).
  The upload request must carry `Content-Length` (else 411); bodies over `MAX_UPLOAD_MB` + 64 KB get 413 before
  they are read (`app/upload_limit.py`). A retried upload of an already uploaded exam gets 409 — firmware treats
  409 as "already done".
- Save WAV as `storage/recordings/<uuid>.wav`. File names never contain patient names.
- After upload, run analysis as a FastAPI BackgroundTask through an `Analyzer` interface.
  For now only a `DummyAnalyzer` exists (quality=`unknown`, label=`not_analyzed`). Real models come later.

## Security
- bcrypt for passwords; device API keys stored hashed; short-lived JWT access tokens.
- Role checks via FastAPI dependencies, never ad-hoc inside handlers.
- Write an `audit_logs` row whenever a doctor or patient reads patient data.
- Uploads: accept WAV only, enforce a size limit.
- Secrets only in `.env` (gitignored); commit `.env.example`. CORS origins from env.

## Working rules
- Write tests together with each feature. Run `pytest` and keep it green before calling a task done.
- Do NOT build any UI or visual design. No frontend code until explicitly asked.
- Do NOT add real AI model code yet — only the `Analyzer` interface and the dummy.
- No microservices, no Celery/Redis, no Kubernetes.
- Ask before adding dependencies outside the stack above.
- Small, focused commits with clear messages.
- Keep `README.md` up to date with how to run the project and the tests.
