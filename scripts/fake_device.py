"""Simulated MurMur device: does over HTTP exactly what the ESP32 firmware will do.

    heartbeat every 10 s → poll for a command every 1.5 s → on "record": wait the recording time,
    then upload a WAV from disk (+ meta JSON) → back to polling.

Standard library only, so it also serves as a reference for the firmware's HTTP calls.

Usage (the device key is the one the admin got when registering the device; pass it via env, not argv,
so it does not end up in shell history):

    set MURMUR_DEVICE_KEY=...            (PowerShell: $env:MURMUR_DEVICE_KEY="...")
    py scripts/fake_device.py --wav samples/2530_AV.wav
    py scripts/fake_device.py --samples samples/ --once --fast

--wav FILE       always upload this file
--samples DIR    upload the WAVs in DIR one after another (sorted by name)
--once           exit after one recording has been uploaded
--fast           do not really wait the 20 s "recording" time
--motion         report that the motion sensor saw movement during the recording
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid
import wave
from itertools import cycle
from pathlib import Path

FIRMWARE_VERSION = "fake-0.1.0"
FAKE_RSSI = -58


class Device:
    def __init__(self, server: str, api_key: str):
        self.server = server.rstrip("/")
        self.api_key = api_key

    def _request(self, method: str, path: str, body: bytes | None = None, content_type: str | None = None):
        request = urllib.request.Request(self.server + path, data=body, method=method)
        request.add_header("X-Device-Key", self.api_key)
        if content_type:
            request.add_header("Content-Type", content_type)
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                raw = response.read()
                return response.status, (json.loads(raw) if raw else None)
        except urllib.error.HTTPError as error:
            raw = error.read()
            try:
                return error.code, json.loads(raw) if raw else None
            except json.JSONDecodeError:
                return error.code, raw.decode(errors="replace")

    def heartbeat(self) -> int:
        body = json.dumps({"firmware_version": FIRMWARE_VERSION, "wifi_rssi": FAKE_RSSI}).encode()
        status, _ = self._request("POST", "/api/device/heartbeat", body, "application/json")
        return status

    def poll(self) -> dict | None:
        status, body = self._request("GET", "/api/device/command")
        if status == 204:
            return None
        if status != 200:
            raise RuntimeError(f"poll failed: {status} {body}")
        return body

    def upload(self, exam_id: int, wav_path: Path, motion: bool) -> tuple[int, object]:
        with wave.open(str(wav_path)) as wav:
            sample_rate = wav.getframerate()
        meta = json.dumps({"motion_detected": motion, "sample_rate": sample_rate})
        boundary = uuid.uuid4().hex
        body = b"".join(
            [
                f"--{boundary}\r\n".encode(),
                b'Content-Disposition: form-data; name="meta"\r\n\r\n',
                meta.encode(),
                b"\r\n",
                f"--{boundary}\r\n".encode(),
                f'Content-Disposition: form-data; name="audio"; filename="{wav_path.name}"\r\n'.encode(),
                b"Content-Type: audio/wav\r\n\r\n",
                wav_path.read_bytes(),
                b"\r\n",
                f"--{boundary}--\r\n".encode(),
            ]
        )  # urllib sends Content-Length for a bytes body; the server requires it
        return self._request("POST", f"/api/device/upload/{exam_id}", body, f"multipart/form-data; boundary={boundary}")


def log(message: str) -> None:
    print(time.strftime("%H:%M:%S"), message, flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--server", default="http://localhost:8000")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--wav", type=Path)
    source.add_argument("--samples", type=Path)
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--fast", action="store_true")
    parser.add_argument("--motion", action="store_true")
    parser.add_argument("--poll-seconds", type=float, default=1.5)
    parser.add_argument("--heartbeat-seconds", type=float, default=10.0)
    args = parser.parse_args()

    api_key = os.environ.get("MURMUR_DEVICE_KEY")
    if not api_key:
        print("MURMUR_DEVICE_KEY is <missing>", file=sys.stderr)
        return 1
    files = [args.wav] if args.wav else sorted(args.samples.glob("*.wav"))
    if not files or not all(f.is_file() for f in files):
        print("no WAV files found", file=sys.stderr)
        return 1
    next_file = cycle(files)

    device = Device(args.server, api_key)
    status = device.heartbeat()
    if status == 401:
        print("server rejected the device key (401)", file=sys.stderr)
        return 1
    log(f"online: heartbeat {status}, {len(files)} WAV file(s) ready, polling every {args.poll_seconds} s")

    last_heartbeat = time.monotonic()
    while True:
        if time.monotonic() - last_heartbeat >= args.heartbeat_seconds:
            device.heartbeat()
            last_heartbeat = time.monotonic()

        command = device.poll()
        if command is None:
            time.sleep(args.poll_seconds)
            continue

        exam_id, seconds = command["exam_id"], command["duration_s"]
        log(f"command: {command['command']} {seconds} s for exam {exam_id} (LED on)")
        time.sleep(0.5 if args.fast else seconds)
        wav_path = next(next_file)
        status, body = device.upload(exam_id, wav_path, args.motion)
        if status == 202:
            log(f"uploaded {wav_path.name} for exam {exam_id}: {body}")
        elif status == 409:
            log(f"exam {exam_id} already has a recording (409), treating as done")
        else:
            log(f"upload FAILED for exam {exam_id}: {status} {body}")
        if args.once:
            return 0 if status in (202, 409) else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(0)
