"""Download the ECG rhythm data from PhysioNet into samples/ecg/ (gitignored). Stdlib urllib only.

Run from backend/:  uv run python -I ../scripts/ai/ecg/download.py
1. CinC 2017 training set: training2017.zip (~95 MB, checked against PhysioNet's SHA256SUMS.txt) + REFERENCE-v3.csv.
2. PTB-XL 1.0.3 index files, then ONLY the 500 Hz records of strat_fold 10 that are AF (every one) or clean sinus
   rhythm (NORM + SR, a seeded sample of up to 3x the AF count, capped so the download stays near 60 MB).
   The chosen list is written to split/ptbxl_fold10.csv (committed), so the external test set never changes.
"""

import ast
import csv
import hashlib
import random
import sys
import time
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from data import CINC_DIR, PTBXL_DIR, SPLIT_DIR  # noqa: E402

CINC_URL = "https://physionet.org/files/challenge-2017/1.0.0/"
CINC_FILES = {  # name → SHA-256 of our first download (2026-11-17)
    "training2017.zip": "25fdbab36bb6724b66a4d2c26ff89f6b9d6ff87e6aed714d24cf5bf071cd1255",
    "REFERENCE-v3.csv": "ae517e474b0bc89a7517ad876b5b4dadc6c94f680d0665c04746db9432df855b",
}
PTBXL_URL = "https://physionet.org/files/ptb-xl/1.0.3/"
SEED = 2017
SINUS_PER_AF = 3
MAX_RECORDS = 500  # one 500 Hz PTB-XL record (.dat + .hea) is ~120 KB → ~60 MB
AGENT = {"User-Agent": "murmur-research-download/1.0 (python urllib)"}


def fetch(url: str, dest: Path, tries: int = 4) -> Path:
    """Download `url` to `dest` (skipped when already there); written via a .part file so a broken run never
    leaves a half file under the final name."""
    if dest.exists():
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    for attempt in range(1, tries + 1):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=AGENT), timeout=120) as resp:
                with open(part, "wb") as out:
                    while chunk := resp.read(1 << 20):
                        out.write(chunk)
            part.replace(dest)
            return dest
        except OSError as error:
            if attempt == tries:
                raise RuntimeError(f"download failed: {url}: {error}") from error
            time.sleep(2 * attempt)
    raise AssertionError("unreachable")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while chunk := handle.read(1 << 20):
            digest.update(chunk)
    return digest.hexdigest()


def safe_extract(archive: Path, target: Path) -> None:
    """Unzip, refusing any member that would land outside `target` (absolute paths, `..`)."""
    root = target.resolve()
    with zipfile.ZipFile(archive) as zf:
        for member in zf.infolist():
            out = (root / member.filename).resolve()
            if not out.is_relative_to(root):
                raise RuntimeError(f"unsafe path in zip: {member.filename!r}")
        zf.extractall(root)


def cinc() -> None:
    # This 2017 project publishes no SHA256SUMS.txt, so the hashes of our first download are pinned here.
    for name, expected in CINC_FILES.items():
        path = fetch(CINC_URL + name, CINC_DIR / name)
        got = sha256(path)
        if expected and got != expected:
            path.unlink()
            raise RuntimeError(f"{name}: SHA-256 differs from the pinned one (file deleted)")
        print(f"{name}: {path.stat().st_size / 1e6:.1f} MB, sha256 {got} {'(pinned, OK)' if expected else ''}")
    if not (CINC_DIR / "training2017" / "REFERENCE.csv").exists():
        safe_extract(CINC_DIR / "training2017.zip", CINC_DIR)
    n = len(list((CINC_DIR / "training2017").glob("*.mat")))
    print(f"CinC 2017: {n} records")


def choose_ptbxl() -> list[dict[str, str]]:
    """Fold-10 records: AF = scp_codes has AFIB; sinus = has NORM and SR and no AFIB / AFLT. Seeded sample."""
    with open(PTBXL_DIR / "ptbxl_database.csv", encoding="utf-8", newline="") as handle:
        rows = [r for r in csv.DictReader(handle) if r["strat_fold"] == "10"]
    af, sinus = [], []
    for row in rows:
        codes = ast.literal_eval(row["scp_codes"])  # a dict literal like {'NORM': 100.0, 'SR': 0.0}
        item = {"ecg_id": str(int(float(row["ecg_id"]))), "filename_hr": row["filename_hr"]}
        if "AFIB" in codes:
            af.append(item | {"label": "af"})
        elif "NORM" in codes and "SR" in codes and "AFLT" not in codes:
            sinus.append(item | {"label": "sinus"})
    n_sinus = min(len(sinus), SINUS_PER_AF * len(af), MAX_RECORDS - len(af))
    picked = random.Random(SEED).sample(sinus, n_sinus)
    print(f"PTB-XL fold 10: {len(rows)} records, {len(af)} AF, {len(sinus)} clean sinus, using {n_sinus} sinus")
    return sorted(af + picked, key=lambda r: int(r["ecg_id"]))


def ptbxl() -> None:
    for name in ("ptbxl_database.csv", "scp_statements.csv"):
        fetch(PTBXL_URL + name, PTBXL_DIR / name)
    out = SPLIT_DIR / "ptbxl_fold10.csv"
    if not out.exists():
        chosen = choose_ptbxl()
        with open(out, "w", encoding="ascii", newline="") as handle:
            writer = csv.DictWriter(handle, ["ecg_id", "filename_hr", "label"], lineterminator="\n")
            writer.writeheader()
            writer.writerows(chosen)
    with open(out, encoding="ascii", newline="") as handle:
        chosen = list(csv.DictReader(handle))
    jobs = []
    for row in chosen:
        rel = row["filename_hr"]
        if not rel.startswith("records500/") or ".." in rel:
            raise RuntimeError(f"unexpected PTB-XL path {rel!r}")
        for ext in (".hea", ".dat"):
            jobs.append((PTBXL_URL + rel + ext, PTBXL_DIR / (rel + ext)))
    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(lambda job: fetch(*job), jobs))
    size = sum(dest.stat().st_size for _, dest in jobs)
    print(f"PTB-XL: {len(chosen)} records ({sum(r['label'] == 'af' for r in chosen)} AF), {size / 1e6:.1f} MB")


if __name__ == "__main__":
    cinc()
    ptbxl()
