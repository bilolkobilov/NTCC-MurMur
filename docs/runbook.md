# Runbook

How to run, configure, test and deploy. Facts only, key names never values.

## Setup

- Python 3.14 is installed through the Python Install Manager; use `py`, not `python` (the `python` command opens the Store alias).
- uv is installed with `py -m pip install --user uv`; its folder `%APPDATA%\Python\Python314\Scripts` is on the user PATH.
- Docker Desktop must be running before the database starts.

## Run locally

Not built yet — Stage 1 step 1 adds `docker-compose.yml` and the backend.

## Checks

Not built yet — Stage 1 step 1 adds `cd backend && uv run pytest`.

## Deploy and rollback

Not documented — ask the owner. (Plan: version 1 runs on a laptop + hotspot, version 2 on a server with HTTPS.)
