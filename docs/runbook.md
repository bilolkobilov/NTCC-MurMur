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
npm run check:offline   # after build: fails if anything would load from the internet
```

**Browser MCP for the agent.** `.mcp.json` registers Playwright MCP (real Chrome, visible window). Start
`docker compose up -d db`, the backend (`:8000`) and `npm run dev` (`:5173`), then the agent can open
`http://localhost:5173`, log in, click through pages, resize to 375 / 768 / 1440 px, read console errors and take
screenshots after a frontend change, and use the forms to edit data. Approve the project MCP server on first start.
Its profile and screenshots go to `.playwright-profile/` and `.playwright-output/` (gitignored). Needs Node and Chrome.

TypeScript is pinned to ~5.9 and linting uses ESLint on purpose: TypeScript 7 / oxlint use native binaries that
Smart App Control blocks or that ESLint cannot use (see docs/decisions/2026-11.md).

## Demo mode (one process, offline laptop)

```bash
cd frontend && npm run build        # creates frontend/dist
cd ../backend && uv run python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Open http://localhost:8000 — FastAPI serves the web app and the API from one origin (no CORS). The full demo
script (admin → device → doctor → patient → audit) is in README.md, "Run the demo". The device on the
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

## AI model (CardioPHON murmur analyzer)

Without this the server runs with `AI_MODEL=dummy` ("No AI opinion"). Spec: `docs/specs/2026-11-08-ai-model.md`.

1. PyTorch (CPU) and numpy come with `cd backend && uv sync` (group `ai`, default since 2026-11-08; first
   `import torch` takes ~20 s once). A server without AI: `uv sync --no-group ai` and `AI_MODEL=dummy`.
2. Encoder weights (CardioPHON, used with citation) into `models/cardiophon/` (the Docker demo carries its own copy in
   `demo/cardiophon/`, committed on purpose — owner, 2026-11-17):
   `curl -L -o models/cardiophon/pretrained_physionet_2022_4kHz.pth https://git.lih.lu/vdespotovic/cardiophon/-/raw/main/heart_sound_classification/checkpoints/pretrained_physionet_2022_4kHz.pth`
3. CirCor 1.0.3 (471 MB zip, ODC-By) unpacked into `samples/circor/`:
   `https://physionet-open.s3.amazonaws.com/circor-heart-sound/circor-heart-sound-1.0.3.zip` (check `SHA256SUMS.txt`).
4. (Optional) compare recipes by cross-validation on training patients only → `docs/specs/ai-experiments.md`:
   `uv run python ../scripts/ai/experiment.py` (~15 min; embeddings cached in `models/cardiophon/`).
5. Train the chosen head + its threshold: `uv run python ../scripts/ai/train_head.py` (~3 min).
6. Measure it once on the held-out patients → `docs/specs/ai-results.md`: `uv run python ../scripts/ai/evaluate.py`.
   On Windows set `PYTHONIOENCODING=utf-8` if the console shows encoding errors.
7. Switch it on in `.env`: `AI_MODEL=cardiophon`, restart the server; the log says `AI model loaded: cardiophon-murmur …`.
   Bump `MODEL_VERSION` in `train_head.py` on every retrain (it is stored with every result).

## ECG rhythm model ("AF suspected")

Heart rate and ECG quality need nothing (pure Python). The rhythm model is optional: without `models/ecg/` the ECG
card says "No rhythm model is connected". Quickest: the trained `ecg-rhythm 1.0.0` is committed in `demo/ecg/` —
copy both files to `models/ecg/` (or set `AI_MODEL_DIR=demo`) and restart the server. To train it yourself (details,
licences, citations: `scripts/ai/ecg/README.md`):

```bash
cd backend
uv run python -X utf8 -I ../scripts/ai/ecg/download.py   # ~100 MB CinC 2017 + ~68 MB PTB-XL subset into samples/ecg/
uv run python -X utf8 -I ../scripts/ai/ecg/train.py      # ~50 min CPU → models/ecg/ecg_rhythm.pt (1.7 MB) + .json
uv run python -X utf8 -I ../scripts/ai/ecg/evaluate.py   # once per model → docs/specs/ecg-ai-results.md
```

The split (`split.py`) is already committed in `scripts/ai/ecg/split/`; never re-split and never tune on test data.
Restart the server after new weights (the model is loaded once).

## Device firmware (ESP32-S3)

Everything about the device — wiring, why the RGB LED (GPIO48) is never used, ECG electrodes on the AUX jack, build and
flash, the serial log, troubleshooting and the bench measurements — is in **`firmware/README.md`**. In short:

1. `copy firmware\murmur\secrets.example.h firmware\murmur\secrets.h`; fill Wi-Fi (2.4 GHz), `SERVER_URL`
   (`http://<laptop IP>:8000`, server started with `--host 0.0.0.0`) and the device key from Admin → Devices.
2. `arduino-cli compile --upload -p COM<n> --fqbn "esp32:esp32:esp32s3:PSRAM=opi,FlashSize=16M,PartitionScheme=app3M_fat9M_16MB,CDCOnBoot=cdc" firmware/murmur`
   on the board's native USB port (no driver).
3. Without the board: `scripts/fake_device.py` does the same over HTTP, with a synthetic ECG.

4. Admin → Devices shows what the heartbeat reports: Wi-Fi, network (IP / MAC partly hidden), microphone noise floor
   (measured at boot and on "Run self-test"), battery (only when `BATTERY_ADC_PIN` is set in `config.h`; the dev board has
   no fuel gauge). Set `LATEST_FIRMWARE` in `.env` to the `FIRMWARE_VERSION` of the newest build so older devices show
   "update available". A device the admin disconnected gets 403 and keeps polling; it works again after "Reconnect".

## Database migrations

```bash
cd backend
uv run python -m alembic revision --autogenerate -m "what changed" --rev-id 000N   # next free number (0012); review the file
uv run python -m alembic upgrade head      # apply
uv run python -m alembic downgrade -1      # roll back the last migration
```

`tests/test_migrations.py` fails if a model was changed without a migration.

## Source code

Private GitHub repo: https://github.com/bilolkobilov/NTCC-MurMur (branch `main`). After `git clone`, follow
"Setup" and "AI model": weights (`models/`), CirCor (`samples/`), `.env` and `firmware/murmur/secrets.h` are not in Git.

## Deploy and rollback

The owner has not chosen a server yet; today the demo runs on a laptop + phone hotspot. What exists:

- Production stack: `docker-compose.yml` (`db` + `api`, every secret from `.env`, database port on 127.0.0.1 only) and
  `backend/Dockerfile`; `docker compose up -d --build`. AI weights are mounted from `./models`.
- Rollback: run the previous image / Git tag, and `uv run python -m alembic downgrade <revision>` for schema changes
  (every migration has a downgrade; 0007 refuses when patients with sex "other" exist).
