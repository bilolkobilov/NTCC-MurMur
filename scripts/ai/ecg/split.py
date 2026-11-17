"""Split the CinC 2017 records ONCE into train / validation / test (80 / 10 / 10, stratified by class, seed 2017).

Run from backend/:  uv run python -I ../scripts/ai/ecg/split.py
CinC 2017 publishes no patient IDs, so this is a record-level split: one person may have records on both sides.
The lists in split/ are committed; the script refuses to overwrite them (the test set must never move).
"""

import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from data import CLASSES, SPLIT_DIR, cinc_labels  # noqa: E402

SEED = 2017
SHARES = {"val": 0.1, "test": 0.1}


def main() -> None:
    names = ("train.txt", "val.txt", "test.txt")
    if any((SPLIT_DIR / n).exists() for n in names):
        raise SystemExit("split/ already exists; the split is made once (delete the files only on purpose)")
    labels = cinc_labels()
    rng = random.Random(SEED)
    parts: dict[str, list[str]] = {"train": [], "val": [], "test": []}
    for cls in CLASSES:
        records = sorted(r for r, c in labels.items() if c == cls)
        rng.shuffle(records)
        n_val, n_test = round(len(records) * SHARES["val"]), round(len(records) * SHARES["test"])
        parts["val"] += records[:n_val]
        parts["test"] += records[n_val : n_val + n_test]
        parts["train"] += records[n_val + n_test :]
    SPLIT_DIR.mkdir(exist_ok=True)
    for part, records in parts.items():
        (SPLIT_DIR / f"{part}.txt").write_text("\n".join(sorted(records)) + "\n", encoding="ascii")
        counts = {cls: sum(labels[r] == cls for r in records) for cls in CLASSES}
        print(part, len(records), counts)


if __name__ == "__main__":
    main()
