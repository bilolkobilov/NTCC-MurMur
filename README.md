# MurMur

A chest-worn device records **20 seconds of heart sound and a single-lead ECG at the same time**. A laptop server
checks the recording, runs a local AI on the sound, measures the heart rate and rhythm in the ECG, and the doctor
reviews everything on a website (uz / ru / en, phone or laptop). NTCC university project.

> **Research prototype and screening aid — not a medical device.** The AI and the ECG numbers help a doctor; they
> never replace the doctor's conclusion.

## Qisqacha (o'zbekcha)

- **Nima:** ko'krakka taqiladigan qurilma 20 soniya yurak tovushi + EKG yozadi → noutbukdagi server tovushni AI bilan,
  EKG'ni zarba/min va ritm bo'yicha tahlil qiladi → shifokor saytda ko'radi va xulosa yozadi.
- **Tez ishga tushirish (faqat Docker):** `docker compose -f docker-compose.demo.yml up --build` → <http://localhost:8000>,
  loginlar pastdagi jadvalda.
- **Qurilma:** ulanish, chiroq (GPIO48), elektrodlar, yuklash — [firmware/README.md](firmware/README.md).
- **Oxirgi o'zgarishlar** — pastdagi bo'limda.

## What's new (v2, 2026-11-17)

- **ECG with the sound.** The firmware (0.3.0) records the ADS1292R ECG together with the microphone; the server
  measures heart rate, beat-to-beat variation and signal quality, and a small rhythm model flags suspected atrial
  fibrillation. The doctor's exam page shows the ECG strip under the heart-sound strip. Patients and admin see none
  of it. A poor ECG never fails the exam; it says "cannot judge" and why.
- **Phone-first website.** One design system (petrol blue) for every page; below 900 px the sidebar becomes a bottom
  tab bar and tables become label/value rows. Every page of all three roles was measured at 375 / 768 / 1440 px.
- **Device ready to flash.** Microphone pins and gain fixed from real recordings; the RGB LED is never used because it
  shares GPIO48 with the ECG chip; full guide in [firmware/README.md](firmware/README.md).
- **Safer backend.** A device taken away (disconnected or given to another doctor) can no longer record an old exam
  later; a lost or compromised device's key dies; exams keep the clinic they were made in; a patient never sees an AI
  label the doctor disagreed with; vitals show numbers only (no invented "normal" ranges).
- **Fixed after the merge:** GitHub `main` could not start (a missing model file hidden by `.gitignore`); every new
  database connection waited ~2 minutes on Windows (`localhost` → IPv6); repository cleaned.
- Details and reasons: [docs/decisions/2026-11.md](docs/decisions/2026-11.md).

## Quick start

### Docker demo (nothing else to install)

```bash
docker compose -f docker-compose.demo.yml up --build
```

Open <http://localhost:8000> (port busy? `API_PORT=8010 docker compose -f docker-compose.demo.yml up --build`).
The `device` service is a simulated device, so the whole chain works without hardware.

| Login | Username | Password |
| --- | --- | --- |
| Admin (at `/login/admin`) | `admin` | `admin-demo-1` |
| Doctor | `doctor` | `doctor-demo-1` |

These are public demo values (fixed in `docker-compose.demo.yml`); never reuse them in a real `.env`.
`docker compose -f docker-compose.demo.yml down -v` deletes the demo data.

### On the laptop (development / offline demo)

Needs Docker Desktop (PostgreSQL), Python 3.14 + [uv](https://docs.astral.sh/uv/), Node 22.

```bash
cp .env.example .env                       # replace every "change-me"
docker compose up -d db
cd frontend && npm install && npm run build && cd ..
cd backend && uv sync
uv run python -m alembic upgrade head
uv run python -m app.cli create-admin      # from FIRST_ADMIN_USERNAME / FIRST_ADMIN_PASSWORD
uv run python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Open <http://localhost:8000>. For the real AI put the model files in `models/` and set `AI_MODEL=cardiophon`
(sound) — the ECG rhythm model is picked up from `models/ecg/` when present ([docs/runbook.md](docs/runbook.md)).

> **Windows:** run tools as `uv run python -m <tool>` (Smart App Control blocks `.exe` launchers in `.venv`), and keep
> `POSTGRES_HOST=127.0.0.1` (with `localhost` every new database connection waits ~2 minutes).

### A device: real or simulated

- **Real board:** [firmware/README.md](firmware/README.md) — wiring, electrodes, `secrets.h`, flashing.
- **Simulated:** register a device as admin (copy its key), then
  `MURMUR_DEVICE_KEY=<key> py scripts/fake_device.py --samples samples/` — it uploads a WAV plus a synthetic ECG
  (`--heart-rate 80`, `--no-ecg`, `--ecg-off` to try the other cases).

## How an exam works

1. **Admin** adds a doctor and registers a device (its key is shown once), assigns the device to the doctor.
2. **Doctor** adds a patient (signed consent), optionally a patient login, and starts an exam: device + chest point.
3. **Device** (polling every 1.5 s) records 20 s of sound + ECG and uploads both.
4. **Server** checks sound quality ("re-record" if too short, silent, clipped or moving), runs the sound AI, measures
   the ECG (heart rate, rhythm), stores the model names and versions.
5. **Doctor** listens, looks at the sound strip, spectrogram and ECG strip, agrees or disagrees with the AI, writes
   the conclusion and confirms.
6. **Patient** sees reviewed exams with the doctor's conclusion on their phone.

Exam status: `waiting → recording → uploaded → analyzed → reviewed` (or `failed`).

## Roles

| Role | Logs in with | Can |
| --- | --- | --- |
| admin | username + password (CLI, `/login/admin`) | doctors, devices (key shown once, assign, disconnect, self-test), stats, audit log; sees a doctor's patient names (owner, 2026-11-15) but never recordings, AI results, ECG or notes |
| doctor | username + password set by the admin | own patients only: create, consent, patient login, exams, listen, ECG, review |
| patient | username + one-time password from the doctor (changed at first login) | own profile and own **reviewed** exams with the doctor's note and the AI's yes / no (hidden when the doctor disagreed); never scores, ECG or unreviewed exams |
| device | `X-Device-Key` header | heartbeat, poll its commands, upload sound + ECG for its own exams |

## Tests

```bash
cd backend
uv run python -m pytest                                  # PostgreSQL test database murmur_test, rebuilt every run
uv run python -m ruff check . ../scripts && uv run python -m ruff format --check . ../scripts
cd ../frontend
npx tsc -b && npm run lint && npm test && npm run build && npm run check:offline
```

## API overview

| Who | Endpoint | What |
| --- | --- | --- |
| all | `POST /api/auth/login` (doctor, patient), `POST /api/auth/admin/login`, `POST /api/auth/change-password`, `GET /api/auth/me` | login (429 after 5 wrong passwords), password change, who am I |
| admin | `/api/admin/doctors…`, `/api/admin/devices…` (`rotate-key`, `disconnect`, `reconnect`, `self-test`, `activity`), `/api/admin/stats`, `/api/admin/audit` | doctors, devices, counts, audit log |
| doctor | `/api/patients…` (registry, summary, consent, login, vitals, exams), `/api/profile` | own patients |
| doctor | `POST /api/exams`, `GET /api/exams/{id}` (with `has_ecg`, `ecg_result`), `GET …/audio`, `GET …/ecg` (strip), `PATCH …/review`, `POST …/cancel` | exams |
| patient | `GET`/`PATCH /api/me`, `GET /api/me/exams` | own data |
| device | `POST /api/device/heartbeat`, `GET /api/device/command`, `POST /api/device/self-test`, `POST /api/device/upload/{exam_id}` (`audio` WAV + optional `ecg` + `meta`) | device link |

Interactive docs: <http://localhost:8000/docs>.

## Where things are

| Folder | What |
| --- | --- |
| `backend/` | FastAPI app, Alembic migrations, pytest tests |
| `frontend/` | React web app (admin / doctor / patient) |
| `firmware/` | ESP32-S3 firmware and the device guide |
| `scripts/` | `fake_device.py`, AI training and evaluation (`scripts/ai/`, `scripts/ai/ecg/`) |
| `docs/` | [map](docs/map.md) (where every file is), [runbook](docs/runbook.md) (run, configure, migrate), [decisions](docs/decisions/), [AI results](docs/specs/ai-results.md), [ECG AI results](docs/specs/ecg-ai-results.md), [glossary](docs/glossary.md) |

Project rules (also read by AI assistants): [AGENTS.md](AGENTS.md). Source: <https://github.com/bilolkobilov/NTCC-MurMur>
(private). Not in Git on purpose: `.env`, `firmware/murmur/secrets.h`, recordings (`storage/`), datasets (`samples/`)
and the trained model files in `models/` (the demo weights in `demo/` are committed — owner's choice, 2026-11-17).
